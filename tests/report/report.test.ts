import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeEquivalenceDigest } from "../../src/report/signer.js";
import { renderReportHtml, writeReports } from "../../src/report/html.js";
import type { EquivalenceReport, FlowDiff, TheseusConfig } from "../../src/types.js";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function sampleConfig(): TheseusConfig {
  return {
    legacyUrl: "http://localhost:3001",
    modernUrl: "http://localhost:3002",
    repoPath: "./modern",
    maxIters: 5,
    flows: [
      {
        id: "checkout",
        name: "Discount & Tax",
        objective: "Add item, apply SAVE10, store total",
        storeKeys: ["final_total"],
      },
    ],
  };
}

function sampleFlow(overrides?: Partial<FlowDiff>): FlowDiff {
  return {
    flowId: "checkout",
    flowName: "Discount & Tax",
    equivalent: true,
    drifts: [],
    legacy: {
      flowId: "checkout",
      targetUrl: "http://localhost:3001",
      exitCode: 0,
      status: "passed",
      storedValues: { final_total: "$97.43", promo: "SAVE10" },
      summary: "ok",
      evidencePath: null,
      evidence: { screenshotDataUri: TINY_PNG, consoleErrors: [], networkErrors: [] },
      durationMs: 1200,
    },
    modern: {
      flowId: "checkout",
      targetUrl: "http://localhost:3002",
      exitCode: 0,
      status: "passed",
      storedValues: { promo: "SAVE10", final_total: "$97.43" },
      summary: "ok",
      evidencePath: null,
      evidence: { screenshotDataUri: TINY_PNG, consoleErrors: [], networkErrors: [] },
      durationMs: 950,
    },
    ...overrides,
  };
}

function sampleReport(overrides?: Partial<EquivalenceReport>): EquivalenceReport {
  const config = sampleConfig();
  const flows = [sampleFlow()];
  const digest = computeEquivalenceDigest({
    config,
    flows,
    gitCommitSha: "abc123def456",
    verdict: "EQUIVALENT",
  });
  return {
    version: "1.0",
    verdict: "EQUIVALENT",
    generatedAt: "2026-11-21T00:00:00.000Z",
    gitCommitSha: "abc123def456",
    digest,
    legacyUrl: config.legacyUrl,
    modernUrl: config.modernUrl,
    flows,
    iterations: [
      {
        iter: 1,
        failingFlowIds: ["checkout"],
        drifts: [
          {
            flowId: "checkout",
            kind: "value_mismatch",
            key: "final_total",
            expected: "$97.43",
            actual: "$98.25",
          },
        ],
        agentPrompt: "Fix tax order",
        gitDiff: "diff --git a/src/pricing.ts b/src/pricing.ts\n-const total = sub * 1.0825 * 0.9;\n+const total = sub * 0.9 * 1.0825;",
        changedFiles: ["src/pricing.ts"],
      },
    ],
    ...overrides,
  };
}

describe("computeEquivalenceDigest", () => {
  it("returns a deterministic 64-char hex SHA-256 regardless of object key order", () => {
    const flowA = sampleFlow();
    const flowB = sampleFlow({
      legacy: {
        ...flowA.legacy,
        storedValues: { promo: "SAVE10", final_total: "$97.43" },
      },
    });

    const d1 = computeEquivalenceDigest({
      config: sampleConfig(),
      flows: [flowA],
      gitCommitSha: "deadbeef",
      verdict: "EQUIVALENT",
    });
    const d2 = computeEquivalenceDigest({
      verdict: "EQUIVALENT",
      gitCommitSha: "deadbeef",
      flows: [flowB],
      config: sampleConfig(),
    });

    expect(d1).toMatch(/^[a-f0-9]{64}$/);
    expect(d1).toBe(d2);
  });

  it("changes when a stored value or gitCommitSha changes", () => {
    const base = {
      config: sampleConfig(),
      flows: [sampleFlow()],
      gitCommitSha: "commit-1",
      verdict: "EQUIVALENT" as const,
    };

    const dBase = computeEquivalenceDigest(base);
    const dCommit = computeEquivalenceDigest({ ...base, gitCommitSha: "commit-2" });
    const changedFlow = sampleFlow({
      modern: { ...sampleFlow().modern, storedValues: { final_total: "$98.25", promo: "SAVE10" } },
    });
    const dValue = computeEquivalenceDigest({ ...base, flows: [changedFlow] });

    expect(dCommit).not.toBe(dBase);
    expect(dValue).not.toBe(dBase);
  });
});

describe("renderReportHtml", () => {
  it("renders standalone dark-mode HTML with zero external resource URLs", () => {
    const report = sampleReport();
    const html = renderReportHtml(report);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(report.verdict);
    expect(html).toContain(report.digest);
    expect(html).toContain(report.legacyUrl);
    expect(html).toContain(report.modernUrl);
    expect(html).toContain("$97.43");
    expect(html).toContain("<details>");
    expect(html).toContain("src/pricing.ts");

    // Side-by-side embedded screenshots
    const imgMatches = html.match(/<img\s+src="data:image\/png;base64,/g) ?? [];
    expect(imgMatches.length).toBe(2);

    // Zero external scripts, stylesheets, or remote images
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/src="https?:\/\//i);
    expect(html).not.toMatch(/url\(\s*['"]?https?:\/\//i);
  });

  it("strictly HTML-escapes untrusted strings to prevent XSS injection", () => {
    const xss = `<script>alert("xss")</script><img src=x onerror='alert(1)'>`;
    const flow = sampleFlow({
      flowName: `Flow ${xss}`,
      equivalent: false,
      drifts: [
        {
          flowId: "checkout",
          kind: "new_console_error",
          expected: "none",
          actual: xss,
        },
      ],
      modern: {
        ...sampleFlow().modern,
        storedValues: { final_total: xss },
        evidence: { screenshotDataUri: `javascript:alert(1)`, consoleErrors: [xss], networkErrors: [] },
      },
    });
    const report = sampleReport({
      verdict: "DRIFT",
      flows: [flow],
      iterations: [
        {
          iter: 1,
          failingFlowIds: ["checkout"],
          drifts: flow.drifts,
          agentPrompt: xss,
          gitDiff: `+ ${xss}`,
          changedFiles: [`${xss}.ts`],
        },
      ],
    });

    const html = renderReportHtml(report);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror='alert(1)'");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("rejects data:image/svg+xml URIs and displays Kane L1 validation badges", () => {
    const svgXss = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+";
    const flow = sampleFlow({
      legacy: {
        ...sampleFlow().legacy,
        evidenceValidation: { valid: true, profile: "L1" },
      },
      modern: {
        ...sampleFlow().modern,
        evidence: { screenshotDataUri: svgXss, consoleErrors: [], networkErrors: [] },
        evidenceValidation: { valid: true, profile: "L1" },
      },
    });
    const html = renderReportHtml(sampleReport({ flows: [flow] }));
    expect(html).not.toContain("image/svg+xml");
    expect(html).toContain("L1 Valid");
  });
});

describe("writeReports", () => {
  it("writes both report.json and report.html to outDir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-report-"));
    try {
      const report = sampleReport();
      const { jsonPath, htmlPath } = await writeReports(dir, report);

      expect(jsonPath).toBe(join(dir, "report.json"));
      expect(htmlPath).toBe(join(dir, "report.html"));

      const jsonRaw = await readFile(jsonPath, "utf8");
      const htmlRaw = await readFile(htmlPath, "utf8");

      expect(JSON.parse(jsonRaw)).toEqual(report);
      expect(htmlRaw).toBe(renderReportHtml(report));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
