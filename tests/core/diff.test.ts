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

  it("ignores Kane numbered duplicate keys (e.g. promo_error_2) when declared key matches", () => {
    const promoFlow: FlowSpec = {
      id: "promo-stacking-guard",
      name: "Promo stacking guard",
      objective: "Store promo_error",
      storeKeys: ["promo_error"],
    };
    const legacy = makeRun({
      flowId: "promo-stacking-guard",
      storedValues: {
        promo_error: "Promo codes cannot be combined",
        promo_error_2: "Promo codes cannot be combined",
      },
    });
    const modern = makeRun({
      flowId: "promo-stacking-guard",
      storedValues: {
        promo_error: "Promo codes cannot be combined",
      },
    });

    const diff = diffFlowResult(promoFlow, legacy, modern);
    expect(diff.equivalent).toBe(true);
    expect(diff.drifts).toEqual([]);
  });

  it("still flags missing_key when a declared storeKey is truly missing in modern", () => {
    const promoFlow: FlowSpec = {
      id: "promo-stacking-guard",
      name: "Promo stacking guard",
      objective: "Store promo_error",
      storeKeys: ["promo_error"],
    };
    const legacy = makeRun({
      flowId: "promo-stacking-guard",
      storedValues: {
        promo_error: "Promo codes cannot be combined",
        promo_error_2: "Promo codes cannot be combined",
      },
    });
    const modern = makeRun({
      flowId: "promo-stacking-guard",
      storedValues: {},
    });

    const diff = diffFlowResult(promoFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts).toEqual([
      {
        flowId: "promo-stacking-guard",
        kind: "missing_key",
        key: "promo_error",
        expected: "Promo codes cannot be combined",
        actual: "<missing>",
      },
    ]);
  });

  it("ignores legacy final-validation status=failed when legacy captured all declared storeKeys and modern passed", () => {
    const flow: FlowSpec = {
      id: "discount-tax-rounding",
      name: "Discount before tax rounding",
      objective: "Store final_total",
      storeKeys: ["final_total"],
    };
    const legacy = makeRun({
      flowId: "discount-tax-rounding",
      status: "failed",
      storedValues: { final_total: "$97.43" },
    });
    const modern = makeRun({
      flowId: "discount-tax-rounding",
      status: "passed",
      storedValues: { final_total: "$97.43" },
    });

    const diff = diffFlowResult(flow, legacy, modern);
    expect(diff.equivalent).toBe(true);
    expect(diff.drifts).toEqual([]);
  });

  it("ignores undeclared Kane internal keys like cp_final when declared storeKeys match", () => {
    const todoFlow: FlowSpec = {
      id: "todomvc-clear-completed",
      name: "TodoMVC clear completed",
      objective: "Store remaining_counter",
      storeKeys: ["remaining_counter"],
    };
    const legacy = makeRun({
      flowId: "todomvc-clear-completed",
      storedValues: {
        remaining_counter: "1 item left",
        cp_final: "1 item left",
      },
    });
    const modern = makeRun({
      flowId: "todomvc-clear-completed",
      storedValues: {
        remaining_counter: "1 item left",
        cp_final: "true",
        remaining_todo: "Write docs",
      },
    });

    const diff = diffFlowResult(todoFlow, legacy, modern);
    expect(diff.equivalent).toBe(true);
    expect(diff.drifts).toEqual([]);
  });

  it("surfaces new Kane CLI --bug-detection findings as kane_bug_detected drifts", () => {
    const legacy = makeRun();
    const modern = makeRun({
      evidence: {
        screenshotDataUri: null,
        consoleErrors: [],
        networkErrors: [],
        bugsDetected: [{ title: "Checkout button disabled on valid cart", severity: "high" }],
      },
    });

    const diff = diffFlowResult(baseFlow, legacy, modern);
    expect(diff.equivalent).toBe(false);
    expect(diff.drifts).toEqual([
      {
        flowId: "discount-tax",
        kind: "kane_bug_detected",
        expected: "none",
        actual: "Checkout button disabled on valid cart",
      },
    ]);
  });
});
