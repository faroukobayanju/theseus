<p align="center">
  <img src="assets/logo.png" alt="Theseus Logo" width="132" />
</p>

<h1 align="center">Theseus</h1>

<p align="center">
  <strong>Rewrite every plank. Prove nothing changed.</strong><br/>
  Open-source CLI that treats your legacy web app as the answer key — powered by TestMu AI Kane CLI.
</p>

<p align="center">
  <a href="docs/cli-reference.md">CLI Reference</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="site/">Next.js Site</a>
</p>

---

<p align="center">
  <img src="assets/theseus-loop.svg" alt="Theseus closed-loop behavioral equivalence diagram" width="100%" />
</p>

## Why Theseus

Hand-written migration tests miss undocumented rules baked into legacy apps, and pixel diffs break the moment you modernize CSS. **Theseus uses your running legacy app as the oracle:**

1. **Baseline once (`theseus baseline`)** — Executes plain-English flows from `theseus.yaml` against the legacy URL in real headless Chrome via `kane-cli run --agent --headless`, caching golden `store as` values, annotated screenshots, console/HAR traces, and L1-validated `.evidence` packs.
2. **Verify (`theseus verify`)** — Runs the identical flows on your modern rewrite and diffs extracted values, status, new console/HTTP 4xx–5xx errors, and native Kane `--bug-detection` findings (exit `0` equivalent, `1` drift, `2` setup error).
3. **Converge (`theseus converge`)** — Sends structured drift reports and browser evidence directly to your coding agent (`claude -p` by default, or any CLI via `--agent-cmd`), re-verifies failing flows, forces a mandatory full regression pass to catch Hydra regressions, merges all `.evidence` packs (`kane-cli evidence merge`), and signs a self-contained SHA-256 HTML certificate (`.theseus/report.html`).

---

## Quickstart

### Prerequisites
- Node.js `>= 22`
- Kane CLI installed and authenticated (for live browser runs):
  ```bash
  npm install -g @testmuai/kane-cli
  kane-cli login
  ```
- A coding agent CLI: Claude Code (`claude`, default), OpenCode (`opencode`), or Gemini CLI (`gemini`)

### Install & Build
```bash
git clone https://github.com/faroukobayanju/theseus.git
cd theseus
npm install
npm run build
npm test
```

### Run Live Benchmarks (`theseus demo`)

**1. Bundled E-Commerce Suite (`shop` — LegacyMart 2012 vs. ModernMart)**
```bash
# Default (Claude Code CLI)
node dist/cli.js demo --suite shop

# Free runner (OpenCode standalone)
node dist/cli.js demo --suite shop --agent-cmd "opencode run --standalone --auto {{prompt}}"
```

**2. Real-World TodoMVC Suite (`todomvc` — Legacy ES5 vs. Modern ESM)**
```bash
node dist/cli.js demo --suite todomvc
```

**3. Instant Zero-Account Replay (`<5s`, no TestMu or LLM credits)**
```bash
npx theseus-verify demo --suite shop --replay
npx theseus-verify demo --suite todomvc --replay
```

Open `.theseus/report.html` after any run to inspect the signed equivalence certificate, side-by-side Chrome screenshots, Kane CLI L1 validation status, and per-iteration git diffs.

---

## Benchmark Suites

| Suite | Legacy Oracle | Modern Rewrite | Planted Real-World Drifts |
|---|---|---|---|
| `shop` ([examples/](examples/)) | LegacyMart 2012 (vanilla HTML/JS) | ModernMart (editorial storefront + `pricing.mjs`) | 1. Tax applied before `SAVE10` discount (`$98.25` vs `$97.43`)<br/>2. Second promo silently overwrites active code instead of blocking stacking<br/>3. `$10.00` minimum order guard dropped on checkout |
| `todomvc` ([benchmarks/todomvc/](benchmarks/todomvc/)) | Spec-compliant ES5 TodoMVC | Modern ESM TodoMVC (`store.mjs`) | 1. Singular footer grammar broken (`"1 items left"` vs `"1 item left"`)<br/>2. Whitespace-only todos accepted into list<br/>3. `Clear completed` wipes active todos alongside completed ones |

---

## Kane CLI Features Integrated

- `kane-cli run --agent --headless` + `kane-cli testmd run --override-start-url --local`
- `--assertion-mode dom|visual`, `--final-validation on|off`, `--bug-detection continue`, `--variables`, `--max-steps`
- `kane-cli evidence validate --profile L1 --json` on every captured `.evidence` pack
- `kane-cli evidence merge` sealing legacy + modern packs into `.theseus/theseus-certificate.evidence`
- `kane-cli explore run --local-orchestration --policy read_only` powering `theseus discover`
- Cross-platform Windows `.cmd` shim resolution (`where.exe` unwrap + stdin prompt piping)

---

## CLI Overview

| Command | Purpose |
|---|---|
| `theseus init` | Scaffold `theseus.yaml` with full Kane CLI verification flags |
| `theseus discover` | Auto-discover legacy app flows into `theseus.yaml` via `kane-cli explore` |
| `theseus baseline` | Capture and cache golden legacy baseline |
| `theseus verify` | CI gate: diff modern URL against baseline (`0` / `1` / `2` exit codes) |
| `theseus converge` | Closed-loop agent patching + full regression pass + signed HTML/JSON certificate |
| `theseus demo` | Run `shop` or `todomvc` benchmark live, or replay committed evidence via `--replay` |

Full flags, `theseus.yaml` schema, and troubleshooting live in [docs/cli-reference.md](docs/cli-reference.md) and [docs/architecture.md](docs/architecture.md).

---

## Landing Page (`site/`)

A standalone Next.js 15 App Router showcase lives in [site/](site/):

```bash
npm --prefix site install
npm --prefix site run dev
```

---

## License

MIT
