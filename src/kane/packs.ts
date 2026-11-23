import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvidenceValidationResult, FlowSpec } from "../types.js";
import { spawnResolved } from "../utils/spawn.js";

function runKaneSubcommand(
  args: string[],
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const child = spawnResolved("kane-cli", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(3);
    }, timeoutMs);

    child.stdout?.on("data", (c: Buffer | string) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer | string) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      stderr += err.message;
      finish(2);
    });
    child.on("close", (code) => {
      finish(code ?? 1);
    });
  });
}

export async function checkKaneAuth(): Promise<{ authenticated: boolean; detail: string }> {
  const res = await runKaneSubcommand(["whoami"], 15_000);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const ok = res.exitCode === 0 && /authenticated/i.test(combined);
  return { authenticated: ok, detail: combined };
}

export async function validateEvidencePack(
  packPath: string,
  profile: "L0" | "L1" = "L1",
): Promise<EvidenceValidationResult> {
  if (!existsSync(packPath)) {
    return { valid: false, profile, summary: "Evidence pack file not found" };
  }
  const res = await runKaneSubcommand(["evidence", "validate", packPath, "--profile", profile, "--json"], 30_000);
  return {
    valid: res.exitCode === 0,
    profile,
    summary: (res.stdout || res.stderr).trim().slice(0, 300),
  };
}

export async function mergeEvidencePacks(
  packPaths: string[],
  outPath: string,
  runId: string,
  policyFile?: string,
): Promise<{ mergedPath: string | null; stdout: string; stderr: string; exitCode: number }> {
  const existing = Array.from(new Set(packPaths.filter((p) => p && existsSync(p))));
  if (existing.length === 0) {
    return { mergedPath: null, stdout: "", stderr: "No evidence packs available to merge", exitCode: 1 };
  }

  await mkdir(dirname(outPath), { recursive: true });
  const args = [
    "evidence",
    "merge",
    "--run-id",
    runId,
    "--out",
    outPath,
    "--on-collision",
    "prefer-latest",
    "--json",
  ];
  if (policyFile && existsSync(policyFile)) {
    args.push("--policy", policyFile);
  }
  args.push(...existing);

  const res = await runKaneSubcommand(args, 45_000);
  const ok = res.exitCode === 0 && existsSync(outPath);
  return {
    mergedPath: ok ? outPath : null,
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.exitCode,
  };
}

export async function exploreAppForFlows(
  url: string,
  opts?: { project?: string; maxLeases?: number; prompt?: string },
): Promise<{ flows: FlowSpec[]; rawEvents: Record<string, unknown>[]; exitCode: number; stderr: string }> {
  const args = [
    "explore",
    "run",
    "--url",
    url,
    "--local-orchestration",
    "--policy",
    "read_only",
    "--headless",
    "--agent",
    "--max-leases",
    String(opts?.maxLeases ?? 8),
  ];
  if (opts?.project) args.push("--project", opts.project);
  if (opts?.prompt) args.push("--prompt", opts.prompt);

  const res = await runKaneSubcommand(args, 180_000);
  const rawEvents: Record<string, unknown>[] = [];
  const discoveredScreens = new Set<string>();

  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const ev = JSON.parse(trimmed) as Record<string, unknown>;
      rawEvents.push(ev);
      const title = ev.screen ?? ev.title ?? ev.route ?? ev.path;
      if (typeof title === "string" && title.trim().length > 0) {
        discoveredScreens.add(title.trim());
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  const flows: FlowSpec[] = Array.from(discoveredScreens)
    .slice(0, 6)
    .map((screen, idx) => ({
      id: `discovered-flow-${idx + 1}`,
      name: `Verify ${screen}`,
      objective: `Open {{url}}, navigate to ${screen}, verify the primary content renders without errors, and store the main heading strictly under key 'heading'.`,
      storeKeys: ["heading"],
      finalValidation: true,
      bugDetection: "continue",
    }));

  return { flows, rawEvents, exitCode: res.exitCode, stderr: res.stderr };
}
