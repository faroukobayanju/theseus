# Theseus Design Spec

**Date:** 2026-11-21
**Target:** KaneCLI Online Hackathon (TestMu AI)

## 1. Intent & Why
Rewriting a legacy web app (e.g., jQuery/PHP → React/Next.js) is high-risk because subtle business-logic quirks drift silently while the UI is modernized. **Theseus** is an installable TypeScript CLI (`npx theseus`) that treats the **legacy app itself as the answer key**: Kane CLI runs the same plain-English flows on Legacy and Modern, extracts values via `store as`, diffs behavior, and drives a coding agent (`claude -p` or any `--agent-cmd`) in a closed loop until both apps are proven behaviorally equivalent—issuing a self-contained, SHA-256-signed HTML equivalence certificate built from both Kane `.evidence` packs.

## 2. Goals
- **Ships:** One-command local demo (`theseus demo`) plus real CLI usage on any two URLs + local repo (`init`, `baseline`, `verify`, `converge`).
- **Verified:** Deterministic behavioral diffing on Kane's `store as` extracted values, flow pass/fail status, and new console/HTTP 4xx–5xx errors.
- **Closed Loop:** Automated `verify → surgical drift prompt → coding agent patch → targeted re-verify → full regression pass` loop with hard credit/stuck-loop guardrails.
- **Craft:** Zero-backend, single-package TypeScript CLI (Node 24, `pnpm`, `tsup`) emitting `.theseus/report.json` and a self-contained dark-mode `.theseus/report.html` with side-by-side Legacy vs. Modern Kane screenshots, per-iteration git diffs, and a SHA-256 integrity digest.

## 3. Non-Goals (Explicitly Out of Scope for MVP)
1. No hosted SaaS, authentication, or database.
2. No pixel/visual screenshot similarity diffing (behavioral equivalence only).
3. No autonomous full-site crawler/spider (flows are declared in `theseus.yaml`).
4. No mobile iOS/Android emulator targets in v1 (Chrome web only).
5. No from-scratch full-app generation (Theseus converges an existing rewrite).
6. No live web-server dashboard (terminal UI + static self-contained `report.html` only).

## 4. Constraints
- **Runtime:** Node.js `>= 22` (local environment: `v24.11.1`), TypeScript strict mode, `pnpm`, `tsup` bundle, `vitest` test suite.
- **Kane CLI:** Invoked via `kane-cli run "<objective>" --agent --headless` (exit codes `0` pass, `1` fail, `2` setup/auth error, `3` timeout).
- **Credit Safety:** Legacy baseline is captured once and cached in `.theseus/baseline/` (`--refresh-baseline` to re-capture). `converge` defaults to `--max-iters 5` and aborts on empty git diff or repeated identical drift signature.
- **Hackathon Rules:** Git repo initialized on or after Nov 12; judges must be able to run locally without external databases or manual key setup.

## 5. Bundled Demo Fixture
- `examples/legacy-shop`: Vanilla HTML + jQuery + zero-dep Node HTTP server (in-memory cart).
- `examples/modern-shop`: React + Vite rewrite with 3 planted behavioral drifts:
  1. **Tax/discount rounding order:** Legacy applies 10% promo discount *before* 8.25% tax rounded to 2 decimals; modern applies tax before discount (or outputs 3 decimals).
  2. **Promo stacking validation:** Legacy rejects a second promo code with `"Promo codes cannot be combined"`; modern silently replaces or stacks it.
  3. **Minimum-order boundary:** Legacy blocks checkout under `$10.00` with `"Minimum order is $10.00"`; modern permits checkout or throws a console error.
