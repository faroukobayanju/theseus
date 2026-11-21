# Theseus MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `theseus`, a standalone TypeScript CLI that proves a rewritten web app is behaviorally equivalent to a legacy app by driving Kane CLI (`--agent --headless`) and a coding agent (`claude -p` or `--agent-cmd`) in a closed convergence loop, plus a one-command bundled demo (`theseus demo`).

**Architecture:** Single-package TypeScript CLI organized by responsibility (`src/kane/` for CLI execution & `.evidence` unpacking, `src/core/` for baseline caching, behavioral diffing, agent invocation & convergence state machine, `src/report/` for SHA-256 signing & self-contained HTML output, and `examples/` for the zero-DB legacy vs. modern demo fixture). All external subprocesses (`kane-cli`, `claude`, `git`) sit behind thin injectable interfaces so the entire core is unit-tested deterministically without burning TestMu credits, followed by a live Kane CLI verification milestone.

**Tech Stack:** TypeScript (strict), Node.js 24, `pnpm`, `tsup`, `vitest`, `commander`, `zod`, `yaml`, `adm-zip`, `picocolors`. Demo apps: vanilla HTML/jQuery/Node `http` (`examples/legacy-shop`) + React/Vite (`examples/modern-shop`).

**Spec:** `docs/superpowers/specs/2026-11-21-theseus-design.md`

---

## Global Constraints

- Node.js `>= 22` (ESM TypeScript, `strict: true`), packaged with `tsup` so `npx theseus` / `theseus` works as a single CLI binary.
- Zero external DB, zero hosted backend, zero pixel-diffing, Chrome web only in v1.
- Kane CLI exit codes: `0` = pass, `1` = fail, `2` = setup/auth error, `3` = timeout.
- Theseus CLI exit codes: `0` = equivalent/success, `1` = drift/failed convergence, `2` = config/auth/setup error.
- Legacy baseline cached in `.theseus/baseline/` so retries never re-run the legacy app unless `--refresh-baseline` is passed.
- Default `--max-iters 5`; abort immediately on empty agent git diff or duplicate consecutive drift signature.
- Every task must leave `pnpm test` and `pnpm typecheck` green before committing.

---

## Engineering Architecture & Data Flow

```text
theseus.yaml
     │
     ▼
┌─────────────────┐   (once, cached)    ┌──────────────────────────┐
│ theseus baseline│ ──────────────────▶ │ kane-cli run --agent     │
└─────────────────┘                     │  → legacyUrl (Chrome)    │
                                        └────────────┬─────────────┘
                                                     │ NDJSON + .evidence zip
                                                     ▼
                                        .theseus/baseline/baseline.json
                                                     │
     ┌───────────────────────────────────────────────┘
     ▼
┌─────────────────┐                     ┌──────────────────────────┐
│ theseus converge│ ── verify failing ─▶│ kane-cli run --agent     │
│  (iter 1..N)    │ ◀── NDJSON+zip ──── │  → modernUrl (Chrome)    │
└────────┬────────┘                     └──────────────────────────┘
         │
         ├── 0 drifts on targeted pass?
         │     └── YES ─▶ Full Regression Pass (all flows)
         │                  ├── 0 drifts ─▶ SHA-256 Digest + report.html/.json (exit 0)
         │                  └── drift!   ─▶ continue loop (caught Hydra regression)
         │
         └── drifts found:
               ├── Stuck-loop guard (same drift hash twice OR empty git diff) ─▶ abort (exit 1)
               └── Build surgical prompt (diff + console/5xx logs)
                     ─▶ invokeAgent (claude -p / --agent-cmd)
                     ─▶ record git diff ─▶ next iteration
```

### Failure Mode & Blast-Radius Matrix

| Failure Mode | Trigger | Expected Behavior |
|---|---|---|
| Noisy/malformed Kane stdout | CLI update banners, partial chunks | Line-buffered NDJSON parser ignores non-JSON lines; still captures events & exit code |
| Kane auth/setup failure (`exit 2`) | Missing TestMu credentials or bad flag | Abort immediately with exit `2` and actionable error; do NOT invoke coding agent |
| Missing/corrupt `.evidence` zip | Early timeout (`exit 3`) or crash | `extractEvidence()` degrades gracefully to empty errors + `screenshotDataUri: null` |
| Stuck agent / credit burn | Agent edits 0 files OR repeats identical drift hash | Abort loop early with verdict `STUCK` (exit `1`), emit partial report |
| Hydra regression | Fixing Flow B breaks Flow A | Full-suite regression pass catches it before certifying `EQUIVALENT` |
| Orphan demo servers | `Ctrl+C` or crash during `theseus demo` | `try/finally` + `SIGINT`/`SIGTERM` handlers kill both child processes |

---

## Review Focus

1. **Noisy stdout / chunked NDJSON from `kane-cli`** — Non-JSON lines and split TCP/pipe chunks must not throw; pinned by `tests/kane/runner.test.ts`.
2. **Missing or corrupt `.evidence` zip** — Must return safe empty `EvidenceSummary` without throwing; pinned by `tests/kane/evidence.test.ts`.
3. **Stuck-loop credit guard** — Identical consecutive drift signature or empty git diff must halt `converge` before `maxIters`; pinned by `tests/core/converge.test.ts`.
4. **Hydra regression catch** — Fixing one flow while breaking a previously passing flow must be caught by the mandatory full regression pass; pinned by `tests/core/converge.test.ts`.
5. **Kane auth/setup error (`exit 2`)** — Must fail fast with CLI exit `2` without invoking the coding agent; pinned by `tests/core/converge.test.ts`.

---

## File Structure

```text
theseus/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── types.ts              # Zod schemas & shared types
│   ├── config.ts             # loadConfig(), scaffoldConfig()
│   ├── kane/
│   │   ├── runner.ts         # spawn kane-cli --agent --headless, parse NDJSON
│   │   └── evidence.ts       # unpack .evidence zip → screenshot + console/network errors
│   ├── core/
│   │   ├── baseline.ts       # save/load .theseus/baseline/baseline.json
│   │   ├── diff.ts           # behavioral diff engine (status, store-as, new errors)
│   │   ├── agent.ts          # buildDriftPrompt(), invokeAgent(), git diff helpers
│   │   └── converge.ts       # closed-loop orchestrator with regression & stuck guards
│   ├── report/
│   │   ├── signer.ts         # canonical SHA-256 equivalence digest
│   │   └── html.ts           # self-contained dark-mode HTML certificate renderer
│   └── cli.ts                # commander CLI: init, baseline, verify, converge, demo
├── examples/
│   ├── theseus.demo.yaml     # 3 plain-English flows with `store as` keys
│   ├── legacy-shop/          # vanilla HTML + jQuery + zero-dep Node server
│   └── modern-shop/          # React + Vite rewrite with 3 planted drifts
└── tests/
    ├── config.test.ts
    ├── kane/runner.test.ts
    ├── kane/evidence.test.ts
    ├── core/baseline.test.ts
    ├── core/diff.test.ts
    ├── core/converge.test.ts
    ├── report/report.test.ts
    └── demo/demo-apps.test.ts
```

---

## Milestone 1: Foundation, Config & Kane CLI Adapter

### Task 1: Project Scaffold, Schemas & Config Loader

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `src/types.ts`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):
  - `FlowSpec`: `{ id: string; name: string; objective: string; storeKeys: string[]; numericTolerance?: number }`
  - `TheseusConfig`: `{ legacyUrl: string; modernUrl: string; repoPath: string; maxIters: number; agentCmd?: string; flows: FlowSpec[] }`
  - `EvidenceSummary`: `{ screenshotDataUri: string | null; consoleErrors: string[]; networkErrors: Array<{ url: string; status: number }> }`
  - `KaneRunResult`: `{ flowId: string; targetUrl: string; exitCode: number; status: "passed" | "failed" | "setup_error" | "timeout"; storedValues: Record<string, string>; summary: string; evidencePath: string | null; evidence: EvidenceSummary; durationMs: number }`
  - `DriftItem`: `{ flowId: string; kind: "status" | "value_mismatch" | "missing_key" | "new_console_error" | "new_network_error"; key?: string; expected: string; actual: string }`
  - `FlowDiff`: `{ flowId: string; flowName: string; equivalent: boolean; drifts: DriftItem[]; legacy: KaneRunResult; modern: KaneRunResult }`
  - `IterationRecord`: `{ iter: number; failingFlowIds: string[]; drifts: DriftItem[]; agentPrompt: string; gitDiff: string; changedFiles: string[] }`
  - `EquivalenceReport`: `{ version: "1.0"; verdict: "EQUIVALENT" | "DRIFT" | "STUCK" | "MAX_ITERS"; generatedAt: string; gitCommitSha: string; digest: string; legacyUrl: string; modernUrl: string; flows: FlowDiff[]; iterations: IterationRecord[] }`
- Produces (`src/config.ts`):
  - `loadConfig(configPath: string): Promise<TheseusConfig>`
  - `scaffoldConfig(targetPath: string, opts?: { legacyUrl?: string; modernUrl?: string; repoPath?: string }): Promise<string>`

- [ ] **Step 1: Initialize package & build/test tooling**
  Create `package.json` (`"type": "module"`, `"bin": { "theseus": "./dist/cli.js" }`, scripts `build`, `typecheck`, `test`), `tsconfig.json` (`strict: true`, `moduleResolution: "bundler"`), `tsup.config.ts` (ESM bundle with `#!/usr/bin/env node` banner for `src/cli.ts`), `vitest.config.ts`. Install dependencies via `pnpm add commander zod yaml adm-zip picocolors` and `pnpm add -D typescript tsup vitest @types/node @types/adm-zip`.

- [ ] **Step 2: Write failing tests in `tests/config.test.ts`**
  Assert:
  1. `loadConfig()` parses valid YAML into `TheseusConfig` with default `maxIters: 5`.
  2. `loadConfig()` throws a descriptive Zod validation error when `flows` is empty or `legacyUrl` is not a valid URL.
  3. `scaffoldConfig()` writes a valid `theseus.yaml` that immediately passes `loadConfig()`.

- [ ] **Step 3: Run tests to verify failure**
  Run: `pnpm test tests/config.test.ts` → Expected: FAIL (modules missing).

- [ ] **Step 4: Implement `src/types.ts` and `src/config.ts`**
  Define Zod schemas for `FlowSpec` and `TheseusConfig`, export all shared TypeScript interfaces, and implement `loadConfig` + `scaffoldConfig`.

- [ ] **Step 5: Verify & commit**
  Run: `pnpm typecheck && pnpm test tests/config.test.ts` → Expected: PASS.
  Commit: `git add -A && git commit -m "feat: scaffold project, schemas, and config loader"`

---

### Task 2: Kane CLI NDJSON Runner & `.evidence` Zip Extractor

**Files:**
- Create: `src/kane/evidence.ts`, `src/kane/runner.ts`
- Test: `tests/kane/evidence.test.ts`, `tests/kane/runner.test.ts`

**Interfaces:**
- Consumes: `FlowSpec`, `EvidenceSummary`, `KaneRunResult` from `src/types.ts`
- Produces (`src/kane/evidence.ts`):
  - `extractEvidence(evidenceZipPath: string | null): Promise<EvidenceSummary>`
- Produces (`src/kane/runner.ts`):
  - `type KaneExecutor = (flow: FlowSpec, targetUrl: string, opts?: KaneRunOptions) => Promise<KaneRunResult>`
  - `parseNdjsonStream(raw: string): { storedValues: Record<string, string>; summary: string; evidencePath: string | null }`
  - `runKaneFlow(flow: FlowSpec, targetUrl: string, opts?: KaneRunOptions): Promise<KaneRunResult>`

- [ ] **Step 1: Write failing tests in `tests/kane/evidence.test.ts`**
  Create an in-memory `AdmZip` fixture containing a tiny PNG screenshot (`screenshots/step-final.png`), `console.json` (with 1 error + 1 info log), and `network.json` (with a `500` and a `200`). Assert:
  1. `extractEvidence(zipPath)` returns a `data:image/png;base64,...` URI, filters only `level === "error"` console entries, and filters `status >= 400` network entries.
  2. `extractEvidence(null)` and `extractEvidence("/nonexistent/file.zip")` return `{ screenshotDataUri: null, consoleErrors: [], networkErrors: [] }` without throwing. (Pins Review Focus #2.)

- [ ] **Step 2: Write failing tests in `tests/kane/runner.test.ts`**
  Assert:
  1. `parseNdjsonStream()` extracts `store as` variables, summary, and `evidencePath` from valid NDJSON lines even when interleaved with non-JSON banner lines and blank lines. (Pins Review Focus #1.)
  2. `runKaneFlow()` with an injected mock spawn returns `status: "passed"` on exit `0`, `"failed"` on exit `1`, `"setup_error"` on exit `2`, `"timeout"` on exit `3`, and injects `targetUrl` into the objective cleanly.

- [ ] **Step 3: Run tests to verify failure**
  Run: `pnpm test tests/kane/` → Expected: FAIL.

- [ ] **Step 4: Implement `src/kane/evidence.ts` and `src/kane/runner.ts`**
  - `evidence.ts`: Safely open zip with `AdmZip`; find last `.png` under `screenshots/` (or root) and base64-encode; parse console/network JSON entries defensively across common field shapes (`level`/`type`, `status`/`statusCode`).
  - `runner.ts`: Spawn `kane-cli run <objective> --agent --headless` (using `child_process.spawn`, no shell interpolation of user strings), line-buffer stdout for NDJSON events, emit optional `onEvent` callback for live terminal progress, map exit codes `0/1/2/3`, and call `extractEvidence()`.

- [ ] **Step 5: Verify & commit**
  Run: `pnpm typecheck && pnpm test tests/kane/` → Expected: PASS.
  Commit: `git add src/kane tests/kane && git commit -m "feat: add Kane CLI NDJSON runner and evidence extractor"`

---

## Milestone 2: Baseline Cache, Behavioral Diff Engine & Equivalence Report

### Task 3: Baseline Cache & Behavioral Diff Engine

**Files:**
- Create: `src/core/baseline.ts`, `src/core/diff.ts`
- Test: `tests/core/baseline.test.ts`, `tests/core/diff.test.ts`

**Interfaces:**
- Consumes: `FlowSpec`, `KaneRunResult`, `DriftItem`, `FlowDiff` from `src/types.ts`
- Produces (`src/core/baseline.ts`):
  - `saveBaseline(baseDir: string, legacyUrl: string, results: KaneRunResult[]): Promise<string>`
  - `loadBaseline(baseDir: string): Promise<{ legacyUrl: string; recordedAt: string; results: Record<string, KaneRunResult> } | null>`
- Produces (`src/core/diff.ts`):
  - `diffFlowResult(flow: FlowSpec, legacy: KaneRunResult, modern: KaneRunResult): FlowDiff`
  - `fingerprintDrifts(diffs: FlowDiff[]): string`

- [ ] **Step 1: Write failing tests in `tests/core/baseline.test.ts` and `tests/core/diff.test.ts`**
  - `baseline.test.ts`: round-trip `saveBaseline` → `loadBaseline` in a temp dir; returns `null` when file absent.
  - `diff.test.ts`:
    1. Identical status + identical `storeKeys` values + no new errors → `equivalent: true`, `drifts: []`.
    2. Value mismatch (`"$97.43"` vs `"$98.25"`) → `kind: "value_mismatch"`, exact `expected`/`actual`.
    3. Missing key in modern → `kind: "missing_key"`.
    4. Modern introduces a new console error or HTTP `500` not present in legacy → `kind: "new_console_error"` / `"new_network_error"`.
    5. Status mismatch (`passed` vs `failed`) → `kind: "status"`.
    6. `fingerprintDrifts()` returns identical SHA-256 string for identical drifts regardless of key ordering.

- [ ] **Step 2: Run tests to verify failure**
  Run: `pnpm test tests/core/baseline.test.ts tests/core/diff.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `src/core/baseline.ts` and `src/core/diff.ts`**
  - Normalize whitespace when comparing string values; support optional `numericTolerance` on `FlowSpec` if both values parse as numbers.
  - `fingerprintDrifts()` hashes sorted `{ flowId, kind, key, expected, actual }` tuples via `node:crypto` SHA-256.

- [ ] **Step 4: Verify & commit**
  Run: `pnpm typecheck && pnpm test tests/core/baseline.test.ts tests/core/diff.test.ts` → Expected: PASS.
  Commit: `git add src/core/baseline.ts src/core/diff.ts tests/core/ && git commit -m "feat: add baseline cache and behavioral diff engine"`

---

### Task 4: SHA-256 Equivalence Signer & Self-Contained HTML Report

**Files:**
- Create: `src/report/signer.ts`, `src/report/html.ts`
- Test: `tests/report/report.test.ts`

**Interfaces:**
- Consumes: `EquivalenceReport`, `TheseusConfig`, `FlowDiff`, `IterationRecord` from `src/types.ts`
- Produces (`src/report/signer.ts`):
  - `computeEquivalenceDigest(input: { config: TheseusConfig; flows: FlowDiff[]; gitCommitSha: string; verdict: EquivalenceReport["verdict"] }): string`
- Produces (`src/report/html.ts`):
  - `renderReportHtml(report: EquivalenceReport): string`
  - `writeReports(outDir: string, report: EquivalenceReport): Promise<{ jsonPath: string; htmlPath: string }>`

- [ ] **Step 1: Write failing tests in `tests/report/report.test.ts`**
  Assert:
  1. `computeEquivalenceDigest()` returns a 64-char hex SHA-256 digest that is deterministic for identical inputs and changes if any stored value or `gitCommitSha` changes.
  2. `renderReportHtml()` outputs valid standalone HTML containing zero external `<script src>` / `<link href="http">`, renders the verdict badge, SHA-256 digest, side-by-side embedded screenshot `<img>` tags, value diff table, iteration git diffs, and HTML-escapes untrusted strings (`<script>` in error messages cannot inject raw HTML).
  3. `writeReports()` writes both `report.json` and `report.html`.

- [ ] **Step 2: Run tests to verify failure**
  Run: `pnpm test tests/report/report.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `src/report/signer.ts` and `src/report/html.ts`**
  - Canonicalize keys recursively before hashing in `signer.ts`.
  - Build a clean dark-mode, inline-CSS HTML certificate in `html.ts` with proper HTML escaping (`escapeHtml`).

- [ ] **Step 4: Verify & commit**
  Run: `pnpm typecheck && pnpm test tests/report/report.test.ts` → Expected: PASS.
  Commit: `git add src/report tests/report && git commit -m "feat: add SHA-256 digest signer and self-contained HTML certificate"`

---

## Milestone 3: Closed-Loop Convergence & CLI

### Task 5: Coding Agent Driver & Convergence State Machine

**Files:**
- Create: `src/core/agent.ts`, `src/core/converge.ts`
- Test: `tests/core/converge.test.ts`

**Interfaces:**
- Consumes: `TheseusConfig`, `KaneRunResult`, `FlowDiff`, `EquivalenceReport` (`src/types.ts`), `KaneExecutor` (`src/kane/runner.ts`), `loadBaseline`/`saveBaseline` (`src/core/baseline.ts`), `diffFlowResult`/`fingerprintDrifts` (`src/core/diff.ts`), `computeEquivalenceDigest` (`src/report/signer.ts`)
- Produces (`src/core/agent.ts`):
  - `type AgentExecutor = (prompt: string, repoPath: string, agentCmd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>`
  - `buildDriftPrompt(diffs: FlowDiff[], iter: number): string`
  - `invokeAgent: AgentExecutor`
  - `getGitSnapshot(repoPath: string): Promise<{ commitSha: string; diff: string; changedFiles: string[] }>`
- Produces (`src/core/converge.ts`):
  - `runConvergeLoop(config: TheseusConfig, opts: ConvergeOptions): Promise<EquivalenceReport>`

- [ ] **Step 1: Write failing tests in `tests/core/converge.test.ts`**
  Using injected mock `KaneExecutor`, `AgentExecutor`, and git snapshotter, assert:
  1. **Happy convergence:** Iter 1 fails Flow A & B → agent patches → Iter 2 runs *only* Flow A & B (both pass) → mandatory full regression pass runs all flows (A, B, C) → returns `verdict: "EQUIVALENT"` with 1 iteration recorded.
  2. **Hydra regression catch:** Iter 1 fails Flow B → agent patches Flow B but breaks Flow A → Iter 2 Flow B passes → mandatory full regression pass catches Flow A drift → loop continues to Iter 3 to fix Flow A → ends `EQUIVALENT`. (Pins Review Focus #4.)
  3. **Stuck-loop guard (empty diff):** Agent runs and modifies 0 files → loop aborts immediately with `verdict: "STUCK"` without running Iter 2. (Pins Review Focus #3.)
  4. **Stuck-loop guard (duplicate drift):** Iter 2 produces the exact same drift fingerprint as Iter 1 → loop aborts with `verdict: "STUCK"`. (Pins Review Focus #3.)
  5. **Kane setup error (`exit 2`):** `runConvergeLoop` throws `SetupError` immediately without invoking `AgentExecutor`. (Pins Review Focus #5.)

- [ ] **Step 2: Run tests to verify failure**
  Run: `pnpm test tests/core/converge.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `src/core/agent.ts` and `src/core/converge.ts`**
  - Default agent command: `claude -p <prompt> --allowedTools Edit,Write,Read,Glob,Grep` (or user's `--agent-cmd` template with `{{prompt}}` / stdin).
  - Prompt includes only failing flows, exact `expected` vs `actual` table, console/network errors from `.evidence`, and explicit instruction: *"Fix the behavioral drift in the modern app without breaking other flows."*

- [ ] **Step 4: Verify & commit**
  Run: `pnpm typecheck && pnpm test tests/core/converge.test.ts` → Expected: PASS.
  Commit: `git add src/core/agent.ts src/core/converge.ts tests/core/converge.test.ts && git commit -m "feat: add agent driver and closed-loop convergence engine"`

---

### Task 6: CLI Entrypoint (`init`, `baseline`, `verify`, `converge`, `demo`)

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (verify `bin` field)

**Interfaces:**
- Consumes: `loadConfig`, `scaffoldConfig`, `runKaneFlow`, `saveBaseline`, `loadBaseline`, `diffFlowResult`, `runConvergeLoop`, `writeReports`, `runDemo` (wired in Task 7)

- [ ] **Step 1: Implement `src/cli.ts` with `commander`**
  Wire 5 commands:
  - `theseus init [--legacy <url>] [--modern <url>] [--repo <path>]`
  - `theseus baseline [-c theseus.yaml]`
  - `theseus verify [-c theseus.yaml] [--refresh-baseline]` (exits `0` if equivalent, `1` if drift, `2` on setup/auth error)
  - `theseus converge [-c theseus.yaml] [--max-iters 5] [--agent-cmd <cmd>] [--refresh-baseline]` (streams step progress, writes `.theseus/report.json` + `.theseus/report.html`, prints path & SHA-256 digest, exits `0`/`1`/`2`)
  - `theseus demo [--max-iters 5] [--agent-cmd <cmd>]` (placeholder handler completed in Task 7)

- [ ] **Step 2: Build and smoke-test CLI binary**
  Run: `pnpm build && node dist/cli.js --help` → Expected: prints all 5 subcommands cleanly, exit `0`.

- [ ] **Step 3: Commit**
  Commit: `git add src/cli.ts package.json && git commit -m "feat: wire commander CLI subcommands"`

---

## Milestone 4: Bundled Demo Fixture & Live End-to-End Proof

### Task 7: Bundled Legacy vs. Modern Shop Fixture & `theseus demo` Runner

**Files:**
- Create: `examples/legacy-shop/server.mjs`, `examples/legacy-shop/index.html`
- Create: `examples/modern-shop/` (minimal React + Vite app: `package.json`, `index.html`, `src/App.tsx`, `src/pricing.ts`)
- Create: `examples/theseus.demo.yaml`
- Create: `src/demo.ts` (server spawner, health-check wait, guaranteed `SIGINT`/`SIGTERM`/`finally` cleanup)
- Modify: `src/cli.ts` (connect `theseus demo` to `src/demo.ts`)
- Test: `tests/demo/demo-apps.test.ts`

**Interfaces:**
- Produces (`src/demo.ts`):
  - `runDemo(opts: { maxIters: number; agentCmd?: string; refreshBaseline?: boolean }): Promise<EquivalenceReport>`

- [ ] **Step 1: Build `examples/legacy-shop/`**
  Zero-dependency Node `http` server serving an old-school HTML/jQuery storefront with 3 products and exact legacy rules:
  1. Promo `SAVE10` gives 10% off subtotal *before* 8.25% tax, rounded to 2 decimals (`$100.00 → $90.00 + $7.43 tax = $97.43`).
  2. Applying a second promo code (`SAVE20`) shows `"Promo codes cannot be combined"`.
  3. Checking out with subtotal `< $10.00` shows `"Minimum order is $10.00"`.

- [ ] **Step 2: Build `examples/modern-shop/` with 3 intentional behavioral drifts**
  Clean, modern Tailwind/CSS React + Vite storefront where `src/pricing.ts` / `src/App.tsx` intentionally contain:
  1. Tax applied *before* discount (produces wrong total `$98.25` instead of `$97.43`).
  2. Second promo code silently overwrites/stacks instead of showing `"Promo codes cannot be combined"`.
  3. Checkout under `$10.00` succeeds (or omits `"Minimum order is $10.00"`).

- [ ] **Step 3: Write `examples/theseus.demo.yaml`**
  3 crisp plain-English flows with explicit `store as` extraction keys:
  - `discount-tax-rounding` → stores `final_total`
  - `promo-stacking-guard` → stores `promo_error`
  - `minimum-order-guard` → stores `checkout_error`

- [ ] **Step 4: Write `tests/demo/demo-apps.test.ts` & implement `src/demo.ts`**
  Assert both servers boot on ephemeral ports, respond `200` on `/`, and shut down cleanly on cleanup (zero leaked child processes).

- [ ] **Step 5: Verify & commit**
  Run: `pnpm typecheck && pnpm test && pnpm build` → Expected: ALL PASS.
  Commit: `git add examples src/demo.ts src/cli.ts tests/demo && git commit -m "feat: add bundled legacy-vs-modern shop fixture and demo command"`

---

### Task 8: Live Kane CLI End-to-End Verification & Hackathon Readiness

**Prerequisite (human step before running):**
1. Install Kane CLI: `npm install -g @testmuai/kane-cli`
2. Authenticate with TestMu AI (same email as hackathon registration, 10,000 credits claimed).

- [ ] **Step 1: Calibrate real `kane-cli --agent --headless` NDJSON schema**
  Run a single flow against `examples/legacy-shop`:
  `kane-cli run "Go to http://localhost:<port>, add 1 Widget Pro ($100), apply promo SAVE10, and store the final total as 'final_total'" --agent --headless`
  Verify `src/kane/runner.ts` and `src/kane/evidence.ts` match the exact live NDJSON event keys and `.evidence` zip directory layout; update parser & unit test fixtures if any field name differs.

- [ ] **Step 2: Run full live `theseus demo`**
  Run: `node dist/cli.js demo`
  Expected:
  - Baseline captures legacy shop (`$97.43`, `"Promo codes cannot be combined"`, `"Minimum order is $10.00"`).
  - Iter 1 catches all 3 drifts on `examples/modern-shop`.
  - `claude -p` patches `examples/modern-shop/src/pricing.ts` / `App.tsx`.
  - Targeted re-verify + full regression pass hit `0` drifts.
  - `.theseus/report.html` opens cleanly in Chrome with side-by-side Legacy vs. Modern screenshots, git diffs, and SHA-256 digest.

- [ ] **Step 3: Write crisp `README.md` with quickstart, architecture diagram, and `theseus demo` instructions**
  Reset `examples/modern-shop` back to its drifted state (so judges get the live convergence when they run `theseus demo`), commit everything cleanly, and verify `pnpm test && pnpm build` pass.
