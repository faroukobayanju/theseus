import { describe, expect, it } from "vitest";
import { diffFlowResult, fingerprintDrifts } from "../../src/core/diff.js";
import type { FlowSpec, KaneRunResult } from "../../src/types.js";

const baseFlow: FlowSpec = {
  id: "discount-tax",
  name: "Discount + Tax",
  objective: "Apply SAVE10 and store final_total",
  storeKeys: ["final_total"],
};

function makeRun(overrides: Partial<KaneRunResult> = {}): KaneRunResult {
  return {
    flowId: "discount-tax",
    targetUrl: "http://localhost:3001",
    exitCode: 0,
    status: "passed",
    storedValues: { final_total: "$97.43" },
    summary: "ok",
    evidencePath: null,
    evidence: { screenshotDataUri: null, consoleErrors: [], networkErrors: [] },
    durationMs: 100,
    ...overrides,
  };
}

describe("diffFlowResult", () => {
  it("returns equivalent when status, values (whitespace-normalized), and errors match", () => {
    const legacy = makeRun({ storedValues: { final_total: "  $97.43  " } });
    const modern = makeRun({ storedValues: { final_total: "$97.43" } });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(true);
    expect(diff.drifts).toEqual([]);
  });

  it("supports numericTolerance when both values parse as numbers", () => {
    const flow: FlowSpec = { ...baseFlow, numericTolerance: 0.02 };
    const legacy = makeRun({ storedValues: { final_total: "$97.43" } });
    const close = makeRun({ storedValues: { final_total: "$97.44" } });
    const far = makeRun({ storedValues: { final_total: "$98.25" } });

    expect(diffFlowResult(flow, legacy, close).equivalent).toBe(true);
    expect(diffFlowResult(flow, legacy, far).equivalent).toBe(false);
  });

  it("detects value_mismatch with exact expected and actual", () => {
    const legacy = makeRun({ storedValues: { final_total: "$97.43" } });
    const modern = makeRun({ storedValues: { final_total: "$98.25" } });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts).toEqual([
      {
        flowId: "discount-tax",
        kind: "value_mismatch",
        key: "final_total",
        expected: "$97.43",
        actual: "$98.25",
      },
    ]);
  });

  it("detects missing_key in modern", () => {
    const legacy = makeRun({ storedValues: { final_total: "$97.43" } });
    const modern = makeRun({ storedValues: {} });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts).toEqual([
      {
        flowId: "discount-tax",
        kind: "missing_key",
        key: "final_total",
        expected: "$97.43",
        actual: "<missing>",
      },
    ]);
  });

  it("detects new console and network errors not present in legacy", () => {
    const legacy = makeRun({
      evidence: {
        screenshotDataUri: null,
        consoleErrors: ["legacy warning"],
        networkErrors: [{ url: "/old", status: 404 }],
      },
    });
    const modern = makeRun({
      evidence: {
        screenshotDataUri: null,
        consoleErrors: ["legacy warning", "TypeError: undefined"],
        networkErrors: [
          { url: "/old", status: 404 },
          { url: "/api/checkout", status: 500 },
        ],
      },
    });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts).toEqual([
      {
        flowId: "discount-tax",
        kind: "new_console_error",
        expected: "none",
        actual: "TypeError: undefined",
      },
      {
        flowId: "discount-tax",
        kind: "new_network_error",
        expected: "none",
        actual: "500 /api/checkout",
      },
    ]);
  });

  it("detects status mismatch", () => {
    const legacy = makeRun({ status: "passed" });
    const modern = makeRun({ status: "failed", exitCode: 1 });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts[0]).toEqual({
      flowId: "discount-tax",
      kind: "status",
      expected: "passed",
      actual: "failed",
    });
  });

  it("fingerprintDrifts is deterministic SHA-256 regardless of ordering", () => {
    const flowA: FlowSpec = { ...baseFlow, id: "a", name: "A" };
    const flowB: FlowSpec = { ...baseFlow, id: "b", name: "B" };

    const diffA = diffFlowResult(
      flowA,
      makeRun({ flowId: "a", storedValues: { final_total: "$10" } }),
      makeRun({ flowId: "a", storedValues: { final_total: "$20" } }),
    );
    const diffB = diffFlowResult(
      flowB,
      makeRun({ flowId: "b", storedValues: { final_total: "$30" } }),
      makeRun({ flowId: "b", storedValues: { final_total: "$40" } }),
    );

    const fp1 = fingerprintDrifts([diffA, diffB]);
    const fp2 = fingerprintDrifts([diffB, diffA]);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
  });
});
