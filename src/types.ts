import { z } from "zod";

export const KaneVariableSchema = z.object({
  value: z.string(),
  secret: z.boolean().optional(),
});

export const KaneSettingsSchema = z.object({
  bugDetection: z.enum(["off", "stop", "continue"]).optional(),
  finalValidation: z.boolean().optional(),
  assertionMode: z.enum(["dom", "visual"]).optional(),
  maxSteps: z.number().int().min(1).max(200).optional(),
  timeoutSec: z.number().int().min(10).max(1800).optional(),
  validateEvidence: z.boolean().optional(),
  mergeEvidence: z.boolean().optional(),
  policyFile: z.string().min(1).optional(),
});

export const FlowSpecSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    objective: z.string().min(1).optional(),
    testmdPath: z.string().min(1).optional(),
    storeKeys: z.array(z.string().min(1)).default([]),
    numericTolerance: z.number().nonnegative().optional(),
    assertionMode: z.enum(["dom", "visual"]).optional(),
    finalValidation: z.boolean().optional(),
    bugDetection: z.enum(["off", "stop", "continue"]).optional(),
    variables: z.record(KaneVariableSchema).optional(),
    maxSteps: z.number().int().min(1).max(200).optional(),
  })
  .refine((f) => Boolean(f.objective || f.testmdPath), {
    message: "Flow must define either 'objective' or 'testmdPath'",
  });

export const TheseusConfigSchema = z.object({
  legacyUrl: z.string().url(),
  modernUrl: z.string().url(),
  repoPath: z.string().min(1).default("."),
  maxIters: z.number().int().min(1).max(20).default(5),
  agentCmd: z.string().min(1).optional(),
  kane: KaneSettingsSchema.optional(),
  flows: z.array(FlowSpecSchema).min(1),
});

export type KaneSettings = z.infer<typeof KaneSettingsSchema>;
export type FlowSpec = z.infer<typeof FlowSpecSchema>;
export type TheseusConfig = z.infer<typeof TheseusConfigSchema>;

export interface KaneBugFinding {
  title: string;
  severity?: string;
  detail?: string;
}

export interface EvidenceValidationResult {
  valid: boolean;
  profile: string;
  summary?: string;
}

export interface EvidenceSummary {
  screenshotDataUri: string | null;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  bugsDetected?: KaneBugFinding[];
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
  evidenceValidation?: EvidenceValidationResult;
  durationMs: number;
}

export type DriftKind =
  | "status"
  | "value_mismatch"
  | "missing_key"
  | "new_console_error"
  | "new_network_error"
  | "kane_bug_detected";

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
  mergedEvidencePath?: string | null;
  kaneFeaturesUsed?: string[];
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
