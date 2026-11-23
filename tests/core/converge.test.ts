import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runConvergeLoop } from "../../src/core/converge.js";
import {
  SetupError,
  type FlowSpec,
  type KaneRunResult,
  type TheseusConfig,
} from "../../src/types.js";

const flows: FlowSpec[] = [
  { id: "flow-a", name: "Flow A", objective: "Run A", storeKeys: ["val"] },
  { id: "flow-b", name: "Flow B", objective: "Run B", storeKeys: ["val"] },
  { id: "flow-c", name: "Flow C", objective: "Run C", storeKeys: ["val"] },
];

const baseConfig: TheseusConfig = {
  legacyUrl: "http://localhost:3001",
  modernUrl: "http://localhost:5173",
  repoPath: ".",
  maxIters: 5,
  flows,
};

function makeRun(
  flowId: string,
  targetUrl: string,
  val: string,
  status: KaneRunResult["status"] = "passed",
): KaneRunResult {
  return {
    flowId,
    targetUrl,
    exitCode: status === "passed" ? 0 : status === "setup_error" ? 2 : 1,
    status,
    storedValues: { val },
    summary: status === "setup_error" ? "Missing TestMu API key" : "ok",
    evidencePath: null,
    evidence: { screenshotDataUri: null, consoleErrors: [], networkErrors: [] },
    durationMs: 50,
  };
}

describe("runConvergeLoop", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "theseus-conv-"));
    tempDirs.push(dir);
    return dir;
  }

  it("converges via targeted re-verify followed by mandatory full regression pass", async () => {
    const baseDir = await makeTempDir();
    let patched = false;
    const modernCalls: string[] = [];

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "expected");
      }
      modernCalls.push(flow.id);
      if (!patched && (flow.id === "flow-a" || flow.id === "flow-b")) {
        return makeRun(flow.id, targetUrl, "wrong");
      }
      return makeRun(flow.id, targetUrl, "expected");
    });

    const agentExecutor = vi.fn(async () => {
      patched = true;
      return { exitCode: 0, stdout: "fixed", stderr: "" };
    });

    const gitSnapshotFn = vi.fn(async () => ({
      commitSha: "sha-1",
      diff: patched ? "+fixed A and B" : "",
      changedFiles: patched ? ["src/pricing.ts"] : [],
    }));

    const report = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn,
      digestFn: () => "digest-123",
    });

    expect(report.verdict).toBe("EQUIVALENT");
    expect(report.digest).toBe("digest-123");
    expect(report.iterations).toHaveLength(1);
    expect(report.iterations[0].failingFlowIds).toEqual(["flow-a", "flow-b"]);
    expect(agentExecutor).toHaveBeenCalledTimes(1);
    // Initial full pass (a,b,c) -> targeted re-verify (a,b) -> full regression pass (a,b,c)
    expect(modernCalls).toEqual([
      "flow-a",
      "flow-b",
      "flow-c",
      "flow-a",
      "flow-b",
      "flow-a",
      "flow-b",
      "flow-c",
    ]);
  });

  it("catches Hydra regression during full regression pass and continues until equivalent (Review Focus #4)", async () => {
    const baseDir = await makeTempDir();
    // phase 0: B fails; phase 1 (after iter 1): B fixed, A broken; phase 2 (after iter 2): all pass
    let phase = 0;

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "ok");
      }
      if (phase === 0 && flow.id === "flow-b") {
        return makeRun(flow.id, targetUrl, "broken-b");
      }
      if (phase === 1 && flow.id === "flow-a") {
        return makeRun(flow.id, targetUrl, "broken-a");
      }
      return makeRun(flow.id, targetUrl, "ok");
    });

    const agentExecutor = vi.fn(async () => {
      phase += 1;
      return { exitCode: 0, stdout: `phase-${phase}`, stderr: "" };
    });

    const gitSnapshotFn = vi.fn(async () => ({
      commitSha: `sha-${phase}`,
      diff: phase === 0 ? "" : `+diff-phase-${phase}`,
      changedFiles: phase === 0 ? [] : [`src/file-${phase}.ts`],
    }));

    const report = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn,
      digestFn: () => "hydra-digest",
    });

    expect(report.verdict).toBe("EQUIVALENT");
    expect(agentExecutor).toHaveBeenCalledTimes(2);
    expect(report.iterations).toHaveLength(2);
    expect(report.iterations[0].failingFlowIds).toEqual(["flow-b"]);
    expect(report.iterations[1].failingFlowIds).toEqual(["flow-a"]);
  });

  it("aborts with STUCK when agent changes 0 files (Review Focus #3)", async () => {
    const baseDir = await makeTempDir();

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "ok");
      }
      return makeRun(flow.id, targetUrl, flow.id === "flow-a" ? "bad" : "ok");
    });

    const agentExecutor = vi.fn(async () => ({
      exitCode: 0,
      stdout: "no-op",
      stderr: "",
    }));

    const gitSnapshotFn = vi.fn(async () => ({
      commitSha: "sha-0",
      diff: "",
      changedFiles: [],
    }));

    const report = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn,
      digestFn: () => "stuck-empty",
    });

    expect(report.verdict).toBe("STUCK");
    expect(agentExecutor).toHaveBeenCalledTimes(1);
    expect(report.iterations).toHaveLength(1);
  });

  it("aborts with STUCK when identical drift fingerprint repeats consecutively (Review Focus #3)", async () => {
    const baseDir = await makeTempDir();
    let editCount = 0;

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "ok");
      }
      return makeRun(flow.id, targetUrl, flow.id === "flow-a" ? "still-bad" : "ok");
    });

    const agentExecutor = vi.fn(async () => {
      editCount += 1;
      return { exitCode: 0, stdout: "edited", stderr: "" };
    });

    const gitSnapshotFn = vi.fn(async () => ({
      commitSha: "sha-0",
      diff: editCount === 0 ? "" : `+comment-${editCount}`,
      changedFiles: editCount === 0 ? [] : ["src/app.ts"],
    }));

    const report = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn,
      digestFn: () => "stuck-dup",
    });

    expect(report.verdict).toBe("STUCK");
    expect(agentExecutor).toHaveBeenCalledTimes(1);
    expect(report.iterations).toHaveLength(1);
  });

  it("throws SetupError immediately on Kane setup_error without invoking agent (Review Focus #5)", async () => {
    const baseDir = await makeTempDir();

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "ok");
      }
      return makeRun(flow.id, targetUrl, "", "setup_error");
    });

    const agentExecutor = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const err = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn: async () => ({ commitSha: "sha-0", diff: "", changedFiles: [] }),
      digestFn: () => "never",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SetupError);
    expect((err as SetupError).exitCode).toBe(2);
    expect(agentExecutor).not.toHaveBeenCalled();
  });

  it("does not falsely halt with STUCK on non-git repoPath (commitSha === unknown) when agent fixes drift", async () => {
    const baseDir = await makeTempDir();
    let fixed = false;

    const kaneExecutor = vi.fn(async (flow: FlowSpec, targetUrl: string) => {
      if (targetUrl === baseConfig.legacyUrl) {
        return makeRun(flow.id, targetUrl, "ok");
      }
      return makeRun(flow.id, targetUrl, fixed || flow.id !== "flow-a" ? "ok" : "bad");
    });

    const agentExecutor = vi.fn(async () => {
      fixed = true;
      return { exitCode: 0, stdout: "patched", stderr: "" };
    });

    const report = await runConvergeLoop(baseConfig, {
      baseDir,
      kaneExecutor,
      agentExecutor,
      gitSnapshotFn: async () => ({ commitSha: "unknown", diff: "", changedFiles: [] }),
      digestFn: () => "non-git-pass",
    });

    expect(report.verdict).toBe("EQUIVALENT");
    expect(agentExecutor).toHaveBeenCalledTimes(1);
  });
});
