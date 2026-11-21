import { createHash } from "node:crypto";
import type { DriftItem, FlowDiff, FlowSpec, KaneRunResult } from "../types.js";

function normalizeValue(val: string): string {
  return val.trim().replace(/\s+/g, " ");
}

function parseNumeric(val: string): number | null {
  const cleaned = normalizeValue(val);
  if (!/^-?\$?[\d,]+(\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned.replace(/[$,]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function valuesMatch(expected: string, actual: string, tolerance?: number): boolean {
  const expNorm = normalizeValue(expected);
  const actNorm = normalizeValue(actual);
  if (expNorm === actNorm) return true;

  if (tolerance !== undefined) {
    const expNum = parseNumeric(expNorm);
    const actNum = parseNumeric(actNorm);
    if (expNum !== null && actNum !== null) {
      return Math.abs(expNum - actNum) <= tolerance;
    }
  }
  return false;
}

export function diffFlowResult(
  flow: FlowSpec,
  legacy: KaneRunResult,
  modern: KaneRunResult,
): FlowDiff {
  const drifts: DriftItem[] = [];

  if (legacy.status !== modern.status) {
    drifts.push({
      flowId: flow.id,
      kind: "status",
      expected: legacy.status,
      actual: modern.status,
    });
  }

  const keys = Array.from(
    new Set([...flow.storeKeys, ...Object.keys(legacy.storedValues)]),
  );
  for (const key of keys) {
    const expected = legacy.storedValues[key];
    const actual = modern.storedValues[key];
    if (expected === undefined) continue;

    if (actual === undefined) {
      drifts.push({
        flowId: flow.id,
        kind: "missing_key",
        key,
        expected,
        actual: "<missing>",
      });
    } else if (!valuesMatch(expected, actual, flow.numericTolerance)) {
      drifts.push({
        flowId: flow.id,
        kind: "value_mismatch",
        key,
        expected,
        actual,
      });
    }
  }

  const legacyConsole = new Set(legacy.evidence.consoleErrors);
  for (const err of new Set(modern.evidence.consoleErrors)) {
    if (!legacyConsole.has(err)) {
      drifts.push({
        flowId: flow.id,
        kind: "new_console_error",
        expected: "none",
        actual: err,
      });
    }
  }

  const legacyNet = new Set(
    legacy.evidence.networkErrors.map((e) => `${e.status} ${e.url}`),
  );
  const seenModernNet = new Set<string>();
  for (const err of modern.evidence.networkErrors) {
    const sig = `${err.status} ${err.url}`;
    if (!legacyNet.has(sig) && !seenModernNet.has(sig)) {
      seenModernNet.add(sig);
      drifts.push({
        flowId: flow.id,
        kind: "new_network_error",
        expected: "none",
        actual: sig,
      });
    }
  }

  return {
    flowId: flow.id,
    flowName: flow.name,
    equivalent: drifts.length === 0,
    drifts,
    legacy,
    modern,
  };
}

export function fingerprintDrifts(diffs: FlowDiff[]): string {
  const tuples = diffs
    .flatMap((d) => d.drifts)
    .map((d) => [d.flowId, d.kind, d.key ?? "", d.expected, d.actual])
    .sort((a, b) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return 0;
    });

  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}
