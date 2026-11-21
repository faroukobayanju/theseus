import { z } from "zod";

export const FlowSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  storeKeys: z.array(z.string().min(1)).default([]),
  numericTolerance: z.number().nonnegative().optional(),
});

export const TheseusConfigSchema = z.object({
  legacyUrl: z.string().url(),
  modernUrl: z.string().url(),
  repoPath: z.string().min(1).default("."),
  maxIters: z.number().int().min(1).max(20).default(5),
  agentCmd: z.string().min(1).optional(),
  flows: z.array(FlowSpecSchema).min(1),
});

export type FlowSpec = z.infer<typeof FlowSpecSchema>;
export type TheseusConfig = z.infer<typeof TheseusConfigSchema>;

export interface EvidenceSummary {
  screenshotDataUri: string | null;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
}

export type KaneStatus = "passed" | "failed" | "setup_error" | "timeout";

export interface KaneRunResult {
  flowId: string;
  targetUrl: string;
  exitCode: number;
  status: KaneStatus;
  storedValues: Record<string, string>;
  summary: string;
  evidencePath: string | null;
  evidence: EvidenceSummary;
  durationMs: number;
}

export type DriftKind =
  | "status"
  | "value_mismatch"
  | "missing_key"
  | "new_console_error"
  | "new_network_error";

export interface DriftItem {
  flowId: string;
  kind: DriftKind;
  key?: string;
  expected: string;
  actual: string;
}

export interface FlowDiff {
  flowId: string;
  flowName: string;
  equivalent: boolean;
  drifts: DriftItem[];
  legacy: KaneRunResult;
  modern: KaneRunResult;
}

export interface IterationRecord {
  iter: number;
  failingFlowIds: string[];
  drifts: DriftItem[];
  agentPrompt: string;
  gitDiff: string;
  changedFiles: string[];
}

export type ReportVerdict = "EQUIVALENT" | "DRIFT" | "STUCK" | "MAX_ITERS";

export interface EquivalenceReport {
  version: "1.0";
  verdict: ReportVerdict;
  generatedAt: string;
  gitCommitSha: string;
  digest: string;
  legacyUrl: string;
  modernUrl: string;
  flows: FlowDiff[];
  iterations: IterationRecord[];
}

export class SetupError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}
