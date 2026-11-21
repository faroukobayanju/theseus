import { createHash } from "node:crypto";
import type { EquivalenceReport, FlowDiff, TheseusConfig } from "../types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        out[key] = canonicalize(v);
      }
    }
    return out;
  }
  return value;
}

export function computeEquivalenceDigest(input: {
  config: TheseusConfig;
  flows: FlowDiff[];
  gitCommitSha: string;
  verdict: EquivalenceReport["verdict"];
}): string {
  const canonical = JSON.stringify(canonicalize(input));
  return createHash("sha256").update(canonical).digest("hex");
}
