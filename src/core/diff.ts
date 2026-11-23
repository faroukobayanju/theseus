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

/**
 * Strips auto-incremented LLM suffixes such as `promo_error_2` -> `promo_error`
 * or `final_total_1` -> `final_total`.
 */
export function baseKeyName(key: string): string {
  const match = key.match(/^(.+?)[_-](\d+)$/);
  return match ? match[1] : key;
}

/**
 * Resolves a canonical key from a storedValues map, falling back to a single
 * suffixed alias (e.g. `promo_error_1` / `promo_error_2`) if Kane stored the
 * value under a numbered variant instead of the exact pinned name.
 */
function lookupStoredValue(
  stored: Record<string, string>,
  key: string,
): string | undefined {
  if (stored[key] !== undefined) return stored[key];

  // Look for numbered variants of this key (e.g., promo_error_1, promo_error_2)
  const variants = Object.keys(stored)
    .filter((k) => k !== key && baseKeyName(k) === key)
    .sort();
  if (variants.length > 0) {
    return stored[variants[variants.length - 1]];
  }
  return undefined;
}

/**
 * Removes redundant numbered duplicate keys (e.g. `promo_error_2` when
 * `promo_error` already exists in the same run) so Kane's non-deterministic
 * variable naming cannot manufacture false `missing_key` drifts.
 */
export function canonicalizeStoredValues(
  stored: Record<string, string>,
  declaredKeys: string[],
): Record<string, string> {
  const declaredSet = new Set(declaredKeys);
  const out: Record<string, string> = {};

  for (const key of declaredKeys) {
    const val = lookupStoredValue(stored, key);
    if (val !== undefined) {
      out[key] = val;
    }
  }

  for (const [key, val] of Object.entries(stored)) {
    if (declaredSet.has(key)) continue;
    const base = baseKeyName(key);
    // Drop numbered suffix aliases (like promo_error_2) whenever their base key is
    // already declared or already present in this run's stored values.
    if (base !== key && (declaredSet.has(base) || stored[base] !== undefined)) {
      continue;
    }
    out[key] = val;
  }

  return out;
}

export function diffFlowResult(
  flow: FlowSpec,
  legacy: KaneRunResult,
  modern: KaneRunResult,
): FlowDiff {
  const drifts: DriftItem[] = [];

  const declaredKeys = flow.storeKeys ?? [];
  const legacyCanon = canonicalizeStoredValues(legacy.storedValues, declaredKeys);
  const modernCanon = canonicalizeStoredValues(modern.storedValues, declaredKeys);

  // If Kane's LLM --final-validation flagged the legacy summary as failed even
  // though legacy extracted every declared storeKey and modern passed cleanly,
  // do not fabricate an impossible `expected failed | actual passed` status drift.
  const legacyCapturedAllDeclared =
    declaredKeys.length > 0 && declaredKeys.every((k) => legacyCanon[k] !== undefined);
  const benignLegacyFinalValidationMismatch =
    legacy.status === "failed" &&
    modern.status === "passed" &&
    legacyCapturedAllDeclared;

  if (legacy.status !== modern.status && !benignLegacyFinalValidationMismatch) {
    drifts.push({
      flowId: flow.id,
      kind: "status",
      expected: legacy.status,
      actual: modern.status,
    });
  }

  // 1. Always compare every explicitly declared storeKey strictly (missing in modern = real drift).
  const comparedKeys = new Set<string>();
  for (const key of declaredKeys) {
    comparedKeys.add(key);
    const expected = legacyCanon[key];
    const actual = modernCanon[key];
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

  // 2. When a flow declares explicit storeKeys, compare ONLY those declared keys
  //    (prevents Kane's internal checkpoint variables like `cp_final` flipping
  //    between strings and booleans from causing false STUCK verdicts).
  //    When a flow declares NO storeKeys, compare all canonical legacy keys.
  if (declaredKeys.length === 0) {
    for (const key of Object.keys(legacyCanon)) {
      if (comparedKeys.has(key)) continue;
      const expected = legacyCanon[key];
      const actual = modernCanon[key];

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

  // 3. Surface new product bugs caught natively by Kane CLI's `--bug-detection` engine.
  const legacyBugs = new Set(
    (legacy.evidence.bugsDetected ?? []).map((b) => normalizeValue(b.title).toLowerCase()),
  );
  const seenModernBugs = new Set<string>();
  for (const bug of modern.evidence.bugsDetected ?? []) {
    const sig = normalizeValue(bug.title).toLowerCase();
    if (!sig || legacyBugs.has(sig) || seenModernBugs.has(sig)) continue;
    seenModernBugs.add(sig);
    drifts.push({
      flowId: flow.id,
      kind: "kane_bug_detected",
      expected: "none",
      actual: bug.detail ? `${bug.title}: ${bug.detail}` : bug.title,
    });
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
