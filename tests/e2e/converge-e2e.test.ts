import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { runConvergeLoop } from "../../src/core/converge.js";
import { startDemoServers } from "../../src/demo.js";
import { writeReports } from "../../src/report/html.js";
import { computeEquivalenceDigest } from "../../src/report/signer.js";
import type { FlowSpec, KaneRunResult } from "../../src/types.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeResult(flow: FlowSpec, targetUrl: string, storedValues: Record<string, string>): KaneRunResult {
  return {
    flowId: flow.id,
    targetUrl,
    exitCode: 0,
    status: "passed",
    storedValues,
    summary: "ok",
    evidencePath: null,
    evidence: {
      screenshotDataUri: "data:image/png;base64,iVBORw0KGgo=",
      consoleErrors: [],
      networkErrors: [],
    },
    durationMs: 12,
  };
}

describe("end-to-end demo convergence", () => {
  it("detects all 3 drifts, patches, passes full regression, and emits signed HTML + JSON reports", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "theseus-e2e-"));
    dirs.push(workDir);
    const servers = await startDemoServers();

    try {
      const baseCfg = await loadConfig(resolve("examples/theseus.demo.yaml"));
      const config = { ...baseCfg, legacyUrl: servers.legacyUrl, modernUrl: servers.modernUrl };
      let patched = false;

      const report = await runConvergeLoop(config, {
        baseDir: workDir,
        refreshBaseline: true,
        digestFn: computeEquivalenceDigest,
        kaneExecutor: async (flow, targetUrl) => {
          const isLegacy = targetUrl === servers.legacyUrl;
          if (flow.id === "discount-tax-rounding") {
            return makeResult(flow, targetUrl, {
              final_total: isLegacy || patched ? "$97.43" : "$98.25",
            });
          }
          if (flow.id === "promo-stacking-guard") {
            return makeResult(flow, targetUrl, {
              promo_error: isLegacy || patched ? "Promo codes cannot be combined" : "",
            });
          }
          return makeResult(flow, targetUrl, {
            checkout_error: isLegacy || patched ? "Minimum order is $10.00" : "",
          });
        },
        agentExecutor: async (prompt) => {
          expect(prompt).toContain("$97.43");
          expect(prompt).toContain("Promo codes cannot be combined");
          expect(prompt).toContain("Minimum order is $10.00");
          patched = true;
          return { exitCode: 0, stdout: "patched pricing.mjs", stderr: "" };
        },
        gitSnapshotFn: async () => ({
          commitSha: "abc1234",
          diff: patched ? "diff --git a/pricing.mjs b/pricing.mjs\n+$97.43" : "",
          changedFiles: patched ? ["examples/modern-shop/pricing.mjs"] : [],
        }),
      });

      expect(report.verdict).toBe("EQUIVALENT");
      expect(report.iterations).toHaveLength(1);
      expect(report.digest).toMatch(/^[a-f0-9]{64}$/);

      const { jsonPath, htmlPath } = await writeReports(workDir, report);
      const html = await readFile(htmlPath, "utf8");
      const json = JSON.parse(await readFile(jsonPath, "utf8"));

      expect(json.verdict).toBe("EQUIVALENT");
      expect(html).toContain(report.digest);
      expect(html).toContain("EQUIVALENT");
      expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//i);
    } finally {
      await servers.close();
    }
  });
});
