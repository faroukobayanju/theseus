import { join } from "node:path";
import {
  SetupError,
  type EquivalenceReport,
  type FlowDiff,
  type FlowSpec,
  type IterationRecord,
  type KaneRunResult,
  type TheseusConfig,
} from "../types.js";
import { mergeEvidencePacks } from "../kane/packs.js";
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
  mergeEvidenceFn?: typeof mergeEvidencePacks;
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

function collectKaneFeatures(config: TheseusConfig, mergedPath: string | null): string[] {
  const used = new Set<string>();
  const hasTestmd = config.flows.some((f) => Boolean(f.testmdPath));
  const hasInline = config.flows.some((f) => Boolean(f.objective && !f.testmdPath));

  if (hasInline) used.add("kane-cli run --agent --headless");
  if (hasTestmd) used.add("kane-cli testmd run --override-start-url --local");

  const bugMode = config.kane?.bugDetection ?? config.flows.find((f) => f.bugDetection)?.bugDetection;
  if (bugMode && bugMode !== "off") used.add(`--bug-detection ${bugMode}`);

  const finalVal = config.kane?.finalValidation ?? config.flows.some((f) => f.finalValidation);
  if (finalVal) used.add("--final-validation on");

  const assertMode = config.kane?.assertionMode ?? config.flows.find((f) => f.assertionMode)?.assertionMode;
  if (assertMode) used.add(`--assertion-mode ${assertMode}`);

  if (config.kane?.validateEvidence) used.add("kane-cli evidence validate --profile L1");
  if (mergedPath) used.add("kane-cli evidence merge");

  return Array.from(used);
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
  const mergeFn = opts.mergeEvidenceFn ?? mergeEvidencePacks;
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

    // Seal all legacy + modern Kane .evidence packs into one merged archive when enabled
    let mergedEvidencePath: string | null = null;
    if (config.kane?.mergeEvidence) {
      const packs = flows
        .flatMap((f) => [f.legacy.evidencePath, f.modern.evidencePath])
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (packs.length > 0) {
        progress(`Merging ${packs.length} Kane .evidence pack(s) via kane-cli evidence merge`);
        const runId = `theseus-${Date.now()}`;
        const outPath = join(opts.baseDir, "theseus-certificate.evidence");
        const merged = await mergeFn(packs, outPath, runId, config.kane.policyFile);
        mergedEvidencePath = merged.mergedPath;
      }
    }

    const digest = opts.digestFn({
      config,
      flows,
      gitCommitSha: snap.commitSha,
      verdict,
    });
    const kaneFeaturesUsed = collectKaneFeatures(config, mergedEvidencePath);

    return {
      version: "1.0",
      verdict,
      generatedAt: new Date().toISOString(),
      gitCommitSha: snap.commitSha,
      digest,
      legacyUrl: config.legacyUrl,
      modernUrl: config.modernUrl,
      ...(mergedEvidencePath ? { mergedEvidencePath } : {}),
      ...(kaneFeaturesUsed.length > 0 ? { kaneFeaturesUsed } : {}),
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
    const hasGitTracking =
      beforeSnap.commitSha !== "unknown" || afterSnap.commitSha !== "unknown";
    const noChanges =
      hasGitTracking &&
      (afterSnap.changedFiles.length === 0 ||
        (afterSnap.diff === beforeSnap.diff &&
          sameFileList(afterSnap.changedFiles, beforeSnap.changedFiles)));

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
