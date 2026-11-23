# Theseus CLI & Configuration Reference

Complete technical reference for the `theseus` CLI (`theseus-verify` v0.2.0), the `theseus.yaml` configuration schema, Kane CLI integration flags, and exit codes. All types, defaults, and constraints below match `src/cli.ts` and `src/types.ts`.

## Exit Codes

| Exit Code | Meaning | Triggered By |
|---|---|---|
| `0` | `EQUIVALENT` — 0 behavioral drifts across all flows (after mandatory full regression pass in `converge`/`demo`) | `init`, `discover`, `baseline`, `verify`, `converge`, `demo` |
| `1` | `DRIFT`, `STUCK`, or `MAX_ITERS` — modern app diverged or agent failed to converge | `verify`, `converge`, `demo` |
| `2` | `SetupError` — missing/invalid `theseus.yaml`, `kane-cli` unauthenticated, timeout, or missing replay fixture | Any command |

---

## Commands

### `theseus init`

Scaffolds a `theseus.yaml` configuration pre-wired with Kane CLI verification flags (`assertionMode: dom`, `finalValidation: true`, `bugDetection: continue`, `validateEvidence: true`, `mergeEvidence: true`).

| Flag | Type | Default | Effect |
|---|---|---|---|
| `-o, --output <path>` | `string` | `theseus.yaml` | Destination file path |
| `--legacy <url>` | `string` | `http://localhost:4101` | Legacy app URL |
| `--modern <url>` | `string` | `http://localhost:4102` | Modern rewrite URL |
| `--repo <path>` | `string` | `.` | Path to modern app repository |

```bash
theseus init --legacy http://127.0.0.1:4101 --modern http://127.0.0.1:4102 --repo ./web
```

---

### `theseus discover`

Runs `kane-cli explore run --local-orchestration --policy read_only --headless --agent` against the legacy URL and writes discovered screens/flows into `theseus.yaml`.

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--legacy <url>` | `string` (required) | — | Legacy app URL to explore |
| `--modern <url>` | `string` | `http://127.0.0.1:4102` | Modern rewrite URL recorded in output config |
| `--repo <path>` | `string` | `.` | Modern app repository path |
| `--project <id>` | `string` | `undefined` | Optional TestMu AI Test Manager project ID |
| `--prompt <text>` | `string` | `undefined` | Exploration guidance prompt forwarded to `--prompt` |
| `--max-leases <n>` | `integer` | `8` | Maximum exploration leases |
| `-o, --output <path>` | `string` | `theseus.yaml` | Output YAML path |

```bash
theseus discover --legacy http://127.0.0.1:4101 --modern http://127.0.0.1:4102 --max-leases 6 -o theseus.yaml
```

---

### `theseus baseline`

Executes all flows in `theseus.yaml` against `legacyUrl` via Kane CLI and caches golden `storedValues`, `.evidence` paths, console/network logs, screenshots, and L1 validation results in `.theseus/baseline/baseline.json`.

| Flag | Type | Default | Effect |
|---|---|---|---|
| `-c, --config <path>` | `string` | `theseus.yaml` | Path to config file |

```bash
theseus baseline -c theseus.yaml
```

---

### `theseus verify`

CI gate mode. Runs all flows against `modernUrl` and diffs them against the cached legacy baseline without invoking any coding agent. Captures a baseline automatically if none exists or if `legacyUrl` changed.

| Flag | Type | Default | Effect |
|---|---|---|---|
| `-c, --config <path>` | `string` | `theseus.yaml` | Path to config file |
| `--refresh-baseline` | `boolean` | `false` | Force re-capture of legacy baseline before diffing |

```bash
theseus verify -c theseus.yaml --refresh-baseline
```

---

### `theseus converge`

Runs the closed-loop convergence engine: baseline -> initial verify -> iterative coding agent patching -> targeted re-verify -> mandatory full regression pass -> evidence merge -> SHA-256 signed `.theseus/report.html` and `.theseus/report.json`.

| Flag | Type | Default | Effect |
|---|---|---|---|
| `-c, --config <path>` | `string` | `theseus.yaml` | Path to config file |
| `--max-iters <n>` | `integer` (`1..20`) | `config.maxIters` (`5`) | Maximum agent patch iterations |
| `--agent-cmd <cmd>` | `string` | `undefined` (defaults to `claude -p`) | Custom coding agent shell command; use `{{prompt}}` placeholder or read prompt from stdin |
| `--refresh-baseline` | `boolean` | `false` | Force re-capture of legacy baseline |

```bash
theseus converge -c theseus.yaml --max-iters 5 --agent-cmd "opencode run --standalone --auto {{prompt}}"
```

---

### `theseus demo`

Boots a bundled zero-database Legacy vs. Modern benchmark suite on ephemeral `127.0.0.1` ports and runs live convergence—or replays committed Kane CLI evidence in under 5 seconds with zero external accounts.

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--suite <name>` | `"shop" \| "todomvc"` | `"shop"` | Select `examples/` Shop (LegacyMart vs ModernMart) or `benchmarks/todomvc/` TodoMVC |
| `--replay` | `boolean` | `false` | Instant `<5s` replay of committed Kane CLI evidence (no TestMu or LLM account needed) |
| `--max-iters <n>` | `integer` | `5` | Maximum agent patch iterations |
| `--agent-cmd <cmd>` | `string` | `undefined` (defaults to `claude -p`) | Custom coding agent command |
| `--refresh-baseline` | `boolean` | `true` | Re-capture legacy baseline on each live demo run |

```bash
# Instant replay (no account or credits needed)
npx theseus-verify demo --suite shop --replay

# Live convergence with default Claude Code CLI
node dist/cli.js demo --suite todomvc

# Live convergence with free OpenCode CLI
node dist/cli.js demo --suite shop --agent-cmd "opencode run --standalone --auto {{prompt}}"
```

---

## Configuration Schema (`theseus.yaml`)

Validated strictly via Zod (`TheseusConfigSchema` in `src/types.ts`).

### Top-Level Fields

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `legacyUrl` | `string` | Yes | — | Valid URL (`http://` or `https://`) |
| `modernUrl` | `string` | Yes | — | Valid URL (`http://` or `https://`) |
| `repoPath` | `string` | No | `"."` | Non-empty path to modern rewrite source directory |
| `maxIters` | `integer` | No | `5` | `1 <= maxIters <= 20` |
| `agentCmd` | `string` | No | `undefined` | Non-empty command template; defaults to `claude -p` when omitted |
| `kane` | `KaneSettings` | No | `undefined` | Suite-wide Kane CLI defaults (overridable per flow) |
| `flows` | `FlowSpec[]` | Yes | — | Minimum 1 flow |

### `kane` Settings (`KaneSettingsSchema`)

| Field | Type | Default | Effect |
|---|---|---|---|
| `assertionMode` | `"dom" \| "visual"` | `undefined` | Forwarded as `--assertion-mode <mode>` to `kane-cli` |
| `finalValidation` | `boolean` | `undefined` | Forwarded as `--final-validation on\|off` |
| `bugDetection` | `"off" \| "stop" \| "continue"` | `undefined` | Forwarded as `--bug-detection <mode>`; findings surface as `kane_bug_detected` drifts |
| `maxSteps` | `integer` (`1..200`) | `undefined` | Forwarded as `--max-steps <n>` |
| `timeoutSec` | `integer` (`10..1800`) | `undefined` | Per-flow execution timeout |
| `validateEvidence` | `boolean` | `undefined` | Runs `kane-cli evidence validate <pack> --profile L1 --json` on every `.evidence` pack |
| `mergeEvidence` | `boolean` | `undefined` | Merges all legacy + modern `.evidence` packs into `.theseus/theseus-certificate.evidence` via `kane-cli evidence merge` |
| `policyFile` | `string` | `undefined` | Optional policy file passed as `--policy <file>` to `kane-cli evidence merge` |

### Flow Definition (`FlowSpecSchema`)

Each flow must define either `objective` (inline plain-English instruction) or `testmdPath` (a `.test.md` file executed via `kane-cli testmd run --override-start-url --local`).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | `string` | Yes | — | Stable identifier used in baselines, diffs, and reports |
| `name` | `string` | Yes | — | Human-readable flow title |
| `objective` | `string` | Conditional | `undefined` | Plain-English prompt; `{{url}}` is replaced with `legacyUrl` or `modernUrl` |
| `testmdPath` | `string` | Conditional | `undefined` | Path to a TestMD specification file |
| `storeKeys` | `string[]` | No | `[]` | Declared keys extracted via `store as`; missing keys in modern fail strictly as `missing_key` |
| `numericTolerance` | `number` (`>= 0`) | No | `undefined` | Numeric epsilon for currency/float comparisons (e.g. `0.01`) |
| `assertionMode` | `"dom" \| "visual"` | No | Inherits `kane.assertionMode` | Per-flow override |
| `finalValidation` | `boolean` | No | Inherits `kane.finalValidation` | Per-flow override |
| `bugDetection` | `"off" \| "stop" \| "continue"` | No | Inherits `kane.bugDetection` | Per-flow override |
| `variables` | `Record<string, { value: string; secret?: boolean }>` | No | `undefined` | Passed as `--variables` JSON |
| `maxSteps` | `integer` (`1..200`) | No | Inherits `kane.maxSteps` | Per-flow override |

---

## Related

- [Architecture & Convergence Design](architecture.md) — why behavioral equivalence beats pixel diffs, Hydra regression guards, and Windows shim resolution.
- [README](../README.md) — quickstart, bundled benchmarks, and instant replay.
