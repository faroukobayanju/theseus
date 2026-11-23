import { spawn } from "node:child_process";
import type {
  FlowSpec,
  KaneBugFinding,
  KaneRunResult,
  KaneSettings,
  KaneStatus,
} from "../types.js";
import { spawnResolved } from "../utils/spawn.js";
import { extractEvidence } from "./evidence.js";
import { validateEvidencePack } from "./packs.js";

export interface KaneRunOptions {
  timeoutSec?: number;
  kaneSettings?: KaneSettings;
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
  bugsDetected: KaneBugFinding[];
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

function absorbBugs(obj: Record<string, unknown>, target: KaneBugFinding[]): void {
  const pushBug = (raw: unknown) => {
    if (!isRecord(raw)) return;
    const title = String(raw.title ?? raw.summary ?? raw.message ?? raw.description ?? "").trim();
    if (!title) return;
    if (target.some((b) => b.title === title)) return;
    target.push({
      title,
      severity: typeof raw.severity === "string" ? raw.severity : undefined,
      detail: typeof raw.detail === "string"
        ? raw.detail
        : typeof raw.root_cause === "string"
          ? raw.root_cause
          : undefined,
    });
  };

  for (const field of ["bugs", "bugsDetected", "bugs_detected", "findings"]) {
    const arr = obj[field];
    if (Array.isArray(arr)) {
      for (const item of arr) pushBug(item);
    }
  }

  const eventTag = String(obj.type ?? obj.event ?? "").toLowerCase();
  if (eventTag.includes("bug")) {
    pushBug(obj.bug ?? obj);
  }
}

function applyEvent(ev: Record<string, unknown>, acc: ParsedNdjson): void {
  const scopes: Record<string, unknown>[] = [ev];
  if (isRecord(ev.data)) scopes.push(ev.data);
  if (isRecord(ev.result)) scopes.push(ev.result);
  if (isRecord(ev.context)) scopes.push(ev.context);
  if (isRecord(ev.coverage)) scopes.push(ev.coverage);

  for (const scope of scopes) {
    absorbStoredValues(scope, acc.storedValues);
    absorbBugs(scope, acc.bugsDetected);

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
    bugsDetected: [],
  };

  for (const line of raw.split(/\r?\n/)) {
    const ev = tryParseEvent(line);
    if (ev) applyEvent(ev, acc);
  }

  return acc;
}

export function buildKaneArgs(
  flow: FlowSpec,
  targetUrl: string,
  opts?: KaneRunOptions,
): string[] {
  const settings = opts?.kaneSettings;
  const assertionMode = flow.assertionMode ?? settings?.assertionMode;
  const finalValidation = flow.finalValidation ?? settings?.finalValidation;
  const bugDetection = flow.bugDetection ?? settings?.bugDetection;
  const maxSteps = flow.maxSteps ?? settings?.maxSteps;
  const timeoutSec = opts?.timeoutSec ?? settings?.timeoutSec;

  const args: string[] = [];

  if (flow.testmdPath) {
    args.push(
      "testmd",
      "run",
      flow.testmdPath,
      "--override-start-url",
      targetUrl,
      "--local",
      "--agent",
      "--headless",
    );
  } else {
    const objective = (flow.objective ?? "").replaceAll("{{url}}", targetUrl);
    args.push("run", objective, "--agent", "--headless");
  }

  if (assertionMode) {
    args.push("--assertion-mode", assertionMode);
  }
  if (finalValidation !== undefined) {
    args.push("--final-validation", finalValidation ? "on" : "off");
  }
  if (bugDetection) {
    args.push("--bug-detection", bugDetection);
  }
  if (maxSteps !== undefined) {
    args.push("--max-steps", String(maxSteps));
  }
  if (timeoutSec !== undefined && timeoutSec > 0) {
    args.push("--timeout", String(timeoutSec));
  }
  if (flow.variables && Object.keys(flow.variables).length > 0) {
    args.push("--variables", JSON.stringify(flow.variables));
  }

  return args;
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
  const spawnImpl = opts?.spawnFn ?? spawn;
  const args = buildKaneArgs(flow, targetUrl, opts);
  const timeoutSec = opts?.timeoutSec ?? opts?.kaneSettings?.timeoutSec;

  const acc: ParsedNdjson = {
    storedValues: {},
    summary: "",
    evidencePath: null,
    bugsDetected: [],
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

    const child = spawnResolved(
      "kane-cli",
      args,
      { stdio: ["ignore", "pipe", "pipe"] },
      spawnImpl,
    );

    const timer =
      timeoutSec && timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
            finish(3);
          }, (timeoutSec + 15) * 1000)
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
  if (acc.bugsDetected.length > 0) {
    const existing = evidence.bugsDetected ?? [];
    const seen = new Set(existing.map((b) => b.title));
    for (const b of acc.bugsDetected) {
      if (!seen.has(b.title)) existing.push(b);
    }
    evidence.bugsDetected = existing;
  }

  let evidenceValidation = undefined;
  if (opts?.kaneSettings?.validateEvidence && acc.evidencePath && spawnImpl === spawn) {
    evidenceValidation = await validateEvidencePack(acc.evidencePath);
  }

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
    ...(evidenceValidation ? { evidenceValidation } : {}),
    durationMs: Date.now() - startedAt,
  };
}
