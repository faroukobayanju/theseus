import {
  SetupError,
  type EquivalenceReport,
  type FlowDiff,
  type FlowSpec,
  type IterationRecord,
  type KaneRunResult,
  type TheseusConfig,
} from "../types.js";
import {
  buildDriftPrompt,
  getGitSnapshot,
  invokeAgent,
  type AgentExecutor,
  type GitSnapshotFn,
} from "./agent.js";
import { loadBaseline, saveBaseline } from "./baseline.js";
import { diffFlowResult, fingerprintDrifts } from "./diff.js";

export interface ConvergeOptions {
  baseDir: string;
  refreshBaseline?: boolean;
  maxIters?: number;
  agentCmd?: string;
  kaneExecutor: (flow: FlowSpec, targetUrl: string) => Promise<KaneRunResult>;
  agentExecutor?: AgentExecutor;
  gitSnapshotFn?: GitSnapshotFn;
  digestFn: (input: {
    config: TheseusConfig;
    flows: FlowDiff[];
    gitCommitSha: string;
    verdict: EquivalenceReport["verdict"];
  }) => string;
  onProgress?: (msg: string) => void;
}

function sameFileList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

async function runFlows(
  flows: FlowSpec[],
  targetUrl: string,
  kaneExecutor: ConvergeOptions["kaneExecutor"],
): Promise<Map<string, KaneRunResult>> {
  const results = new Map<string, KaneRunResult>();
  for (const flow of flows) {
    const res = await kaneExecutor(flow, targetUrl);
    if (res.status === "setup_error") {
      throw new SetupError(
        res.summary || `Kane CLI setup/auth error on flow "${flow.id}"`,
      );
    }
    results.set(flow.id, res);
  }
  return results;
}

export async function runConvergeLoop(
  config: TheseusConfig,
  opts: ConvergeOptions,
): Promise<EquivalenceReport> {
  const maxIters = opts.maxIters ?? config.maxIters;
  const agentExecutor = opts.agentExecutor ?? invokeAgent;
  const gitSnapshotFn = opts.gitSnapshotFn ?? getGitSnapshot;
  const progress = opts.onProgress ?? (() => {});

  const cached = opts.refreshBaseline ? null : await loadBaseline(opts.baseDir);
  const baselineValid =
    cached !== null &&
    cached.legacyUrl === config.legacyUrl &&
    config.flows.every((f) => cached.results[f.id] !== undefined);

  let legacyResults: Record<string, KaneRunResult>;
  if (baselineValid) {
    progress("Loaded cached legacy baseline");
    legacyResults = cached.results;
  } else {
    progress("Recording legacy baseline");
    const recorded = await runFlows(config.flows, config.legacyUrl, opts.kaneExecutor);
    const list = config.flows.map((f) => recorded.get(f.id)!);
    await saveBaseline(opts.baseDir, config.legacyUrl, list);
    legacyResults = Object.fromEntries(list.map((r) => [r.flowId, r]));
  }

  const currentDiffs = new Map<string, FlowDiff>();
  const evaluateFlows = async (flows: FlowSpec[]): Promise<void> => {
    const modernMap = await runFlows(flows, config.modernUrl, opts.kaneExecutor);
    for (const flow of flows) {
      currentDiffs.set(
        flow.id,
        diffFlowResult(flow, legacyResults[flow.id], modernMap.get(flow.id)!),
      );
    }
  };

  const getAllDiffs = (): FlowDiff[] =>
    config.flows.map((f) => currentDiffs.get(f.id)!);

  const finalize = async (
    verdict: EquivalenceReport["verdict"],
    iterations: IterationRecord[],
  ): Promise<EquivalenceReport> => {
    const flows = getAllDiffs();
    const snap = await gitSnapshotFn(config.repoPath);
    const digest = opts.digestFn({
      config,
      flows,
      gitCommitSha: snap.commitSha,
      verdict,
    });
    return {
      version: "1.0",
      verdict,
      generatedAt: new Date().toISOString(),
      gitCommitSha: snap.commitSha,
      digest,
      legacyUrl: config.legacyUrl,
      modernUrl: config.modernUrl,
      flows,
      iterations,
    };
  };

  progress("Running initial verification against modern app");
  await evaluateFlows(config.flows);

  if (getAllDiffs().every((d) => d.equivalent)) {
    return finalize("EQUIVALENT", []);
  }

  const iterations: IterationRecord[] = [];
  let lastFingerprint: string | null = null;

  for (let iter = 1; iter <= maxIters; iter++) {
    const failing = getAllDiffs().filter((d) => !d.equivalent);
    const fingerprint = fingerprintDrifts(failing);

    if (lastFingerprint !== null && fingerprint === lastFingerprint) {
      progress(`Stuck at iteration ${iter}: identical drift fingerprint repeated`);
      return finalize("STUCK", iterations);
    }
    lastFingerprint = fingerprint;

    const agentPrompt = buildDriftPrompt(failing, iter);
    const beforeSnap = await gitSnapshotFn(config.repoPath);

    progress(`Iteration ${iter}/${maxIters}: invoking coding agent`);
    const agentRes = await agentExecutor(agentPrompt, config.repoPath, opts.agentCmd ?? config.agentCmd);
    if (agentRes.exitCode !== 0) {
      const detail = (agentRes.stderr || agentRes.stdout).trim().split(/\r?\n/)[0] ?? "";
      progress(`Agent exited with code ${agentRes.exitCode}${detail ? `: ${detail}` : ""}`);
    }

    const afterSnap = await gitSnapshotFn(config.repoPath);
    const noChanges =
      afterSnap.changedFiles.length === 0 ||
      (afterSnap.diff === beforeSnap.diff &&
        sameFileList(afterSnap.changedFiles, beforeSnap.changedFiles));

    iterations.push({
      iter,
      failingFlowIds: failing.map((d) => d.flowId),
      drifts: failing.flatMap((d) => d.drifts),
      agentPrompt,
      gitDiff: afterSnap.diff,
      changedFiles: afterSnap.changedFiles,
    });

    if (noChanges) {
      progress(`Stuck at iteration ${iter}: agent changed 0 files`);
      return finalize("STUCK", iterations);
    }

    const failingIds = new Set(failing.map((d) => d.flowId));
    const targetFlows = config.flows.filter((f) => failingIds.has(f.id));

    progress(`Iteration ${iter}: targeted re-verify (${targetFlows.length} flow(s))`);
    await evaluateFlows(targetFlows);

    if (getAllDiffs().every((d) => d.equivalent)) {
      progress(`Iteration ${iter}: running full regression pass`);
      await evaluateFlows(config.flows);
      if (getAllDiffs().every((d) => d.equivalent)) {
        return finalize("EQUIVALENT", iterations);
      }
      progress(`Iteration ${iter}: full regression pass caught new drift`);
    }
  }

  return finalize("MAX_ITERS", iterations);
}
