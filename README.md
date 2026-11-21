<p align="center">
  <img src="assets/logo.png" alt="Theseus Logo" width="140" />
</p>

<h1 align="center">Theseus</h1>

<p align="center">
  <strong>Rewrite a legacy web app. Let Kane CLI prove nothing changed.</strong><br/>
  Built for the KaneCLI Online Hackathon by TestMu AI.
</p>

---

## How It Works

Instead of writing fragile migration assertions by hand, **Theseus treats your legacy app as the answer key**:

1. **Baseline once (`theseus baseline`)** — Runs plain-English flows from `theseus.yaml` against the legacy URL via `kane-cli run --agent --headless`, caching golden `store as` values and `.evidence` packs in `.theseus/baseline/`.
2. **Verify (`theseus verify`)** — Runs the same flows against your modern rewrite, diffing extracted values, flow status, and new console/HTTP 4xx–5xx errors (exit `0` equivalent, `1` drift, `2` setup/auth error).
3. **Converge (`theseus converge`)** — Closed loop: feeds exact field-by-field drifts + Kane `.evidence` logs to your coding agent (defaults to `claude -p`, pluggable via `--agent-cmd`), re-verifies failing flows, runs a mandatory full regression pass to catch Hydra regressions, and emits a self-contained, SHA-256-signed HTML equivalence certificate (`.theseus/report.html`).

## Quickstart

### Prerequisites
- Node.js `>= 22`
- Kane CLI installed and authenticated with TestMu AI:
  ```bash
  npm install -g @testmuai/kane-cli
  ```
- A coding agent CLI (defaults to `claude` / Claude Code, or pass `--agent-cmd`)

### Install & Build
```bash
pnpm install
pnpm build
```

### Run the Built-In Live Demo (`theseus demo`)
Boots two zero-DB local apps—**LegacyMart 2012** (vanilla HTML/JS) and **ModernMart** (modern rewrite with 3 planted business-logic drifts: tax/discount rounding order, promo stacking, and minimum order validation)—and converges them live:

```bash
node dist/cli.js demo
```

Open `.theseus/report.html` to view the signed equivalence certificate, side-by-side Kane screenshots, and per-iteration git diffs.

## CLI Commands

| Command | Purpose |
|---|---|
| `theseus init` | Scaffold `theseus.yaml` |
| `theseus baseline` | Capture and cache legacy golden baseline |
| `theseus verify` | Diff modern URL against baseline (`0`/`1`/`2` exit codes) |
| `theseus converge` | Closed-loop agent patching + full regression pass + signed report |
| `theseus demo` | Boot bundled legacy + modern shops and run live convergence |
