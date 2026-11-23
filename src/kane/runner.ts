import { spawn } from "node:child_process";
import type { FlowSpec, KaneRunResult, KaneStatus } from "../types.js";
import { extractEvidence } from "./evidence.js";

export interface KaneRunOptions {
  timeoutSec?: number;
  onEvent?: (ev: Record<string, unknown>) => void;
  spawnFn?: typeof spawn;
}

export type KaneExecutor = (
  flow: FlowSpec,
  targetUrl: string,
  opts?: KaneRunOptions,
) => Promise<KaneRunResult>;

export interface ParsedNdjson {
  storedValues: Record<string, string>;
  summary: string;
  evidencePath: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tryParseEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function absorbStoredValues(obj: Record<string, unknown>, target: Record<string, string>): void {
  for (const field of ["storedValues", "stored_values", "variables", "extracted", "final_state", "memory"]) {
    const map = obj[field];
    if (!isRecord(map)) continue;
    for (const [k, v] of Object.entries(map)) {
      if (field === "final_state" && k === "url") continue;
      if (v === undefined || v === null) continue;
      if (isRecord(v)) {
        const inner = v.value ?? v.extracted_value;
        if (inner !== undefined && inner !== null) {
          target[k] = String(inner);
        }
      } else {
        target[k] = String(v);
      }
    }
  }

  const eventTag = String(obj.type ?? obj.event ?? obj.action ?? "").toLowerCase();
  if (eventTag.includes("store")) {
    const key = obj.key ?? obj.name;
    if (typeof key === "string" && key.length > 0 && obj.value !== undefined && obj.value !== null) {
      target[key] = String(obj.value);
    }
  }
}

function applyEvent(ev: Record<string, unknown>, acc: ParsedNdjson): void {
  const scopes: Record<string, unknown>[] = [ev];
  if (isRecord(ev.data)) scopes.push(ev.data);
  if (isRecord(ev.result)) scopes.push(ev.result);
  if (isRecord(ev.context)) scopes.push(ev.context);

  for (const scope of scopes) {
    absorbStoredValues(scope, acc.storedValues);

    if (typeof scope.summary === "string" && scope.summary.length > 0) {
      acc.summary = scope.summary;
    }

    const evPath =
      scope.evidencePath ??
      scope.evidence_path ??
      (typeof scope.pack === "string" && scope.pack.endsWith(".evidence") ? scope.pack : undefined);
    if (typeof evPath === "string" && evPath.length > 0) {
      acc.evidencePath = evPath;
    }
  }
}

export function parseNdjsonStream(raw: string): ParsedNdjson {
  const acc: ParsedNdjson = {
    storedValues: {},
    summary: "",
    evidencePath: null,
  };

  for (const line of raw.split(/\r?\n/)) {
    const ev = tryParseEvent(line);
    if (ev) applyEvent(ev, acc);
  }

  return acc;
}

function mapExitCode(exitCode: number): KaneStatus {
  switch (exitCode) {
    case 0:
      return "passed";
    case 1:
      return "failed";
    case 2:
      return "setup_error";
    case 3:
      return "timeout";
    default:
      return "failed";
  }
}

export async function runKaneFlow(
  flow: FlowSpec,
  targetUrl: string,
  opts?: KaneRunOptions,
): Promise<KaneRunResult> {
  const startedAt = Date.now();
  const objective = flow.objective.replaceAll("{{url}}", targetUrl);
  const spawnImpl = opts?.spawnFn ?? spawn;

  const acc: ParsedNdjson = {
    storedValues: {},
    summary: "",
    evidencePath: null,
  };

  const { exitCode, stderr } = await new Promise<{ exitCode: number; stderr: string }>((resolve) => {
    let settled = false;
    let timedOut = false;
    let lineBuf = "";
    let stderrBuf = "";

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (lineBuf.length > 0) {
        const ev = tryParseEvent(lineBuf);
        if (ev) {
          applyEvent(ev, acc);
          opts?.onEvent?.(ev);
        }
        lineBuf = "";
      }
      resolve({ exitCode: timedOut ? 3 : code, stderr: stderrBuf });
    };

    const kaneArgs = ["run", objective, "--agent", "--headless"];
    // Windows: npm installs kane-cli as a .cmd shim, which spawn() cannot run without a shell.
    const winKane =
      !opts?.spawnFn && process.platform === "win32" && process.env.APPDATA
        ? `${process.env.APPDATA}\\npm\\node_modules\\@testmuai\\kane-cli\\bin\\kane-cli.cjs`
        : undefined;
    const child = (winKane
      ? spawnImpl(process.execPath, [winKane, ...kaneArgs], { stdio: ["ignore", "pipe", "pipe"] })
      : spawnImpl("kane-cli", kaneArgs, { stdio: ["ignore", "pipe", "pipe"] }));

    const timer =
      opts?.timeoutSec && opts.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
            finish(3);
          }, opts.timeoutSec * 1000)
        : undefined;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const ev = tryParseEvent(line);
        if (ev) {
          applyEvent(ev, acc);
          opts?.onEvent?.(ev);
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBuf += chunk.toString();
    });

    child.on("error", (err) => {
      if (!acc.summary) acc.summary = err.message;
      finish(2);
    });

    child.on("close", (code) => {
      finish(code ?? 1);
    });
  });

  const evidence = await extractEvidence(acc.evidencePath);
  const summary = acc.summary || stderr.trim();

  return {
    flowId: flow.id,
    targetUrl,
    exitCode,
    status: mapExitCode(exitCode),
    storedValues: acc.storedValues,
    summary,
    evidencePath: acc.evidencePath,
    evidence,
    durationMs: Date.now() - startedAt,
  };
}
