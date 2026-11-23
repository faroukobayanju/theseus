# Theseus Site — Design System (`DESIGN.md`)

## Surface & Mode
- **Surface:** `site/src/app/page.tsx` (Next.js 15 App Router, static export to `site/out/`)
- **Mode:** `Persuade` — developer tool landing page for `theseus-verify`
- **Physical Scene:** Dark terminal / CI diff workbench comparing a legacy web app against its modern rewrite

## Color Tokens (`site/src/app/globals.css`)
| Role | CSS Variable | Hex | Usage |
|---|---|---|---|
| Canvas | `--bg-canvas` | `#0B0F19` | Primary page background |
| Surface | `--bg-surface` | `#111827` | Workbench frames, buttons, header rows |
| Elevated | `--bg-elevated` | `#161F33` | Active tab surfaces |
| Code Well | `--bg-code` | `#080C14` | Tables, code blocks, diffs, footer |
| Border Subtle | `--border-subtle` | `#1E293B` | Section dividers, table hairlines |
| Border Strong | `--border-strong` | `#334155` | Interactive controls, ghost buttons |
| Primary Text | `--text-primary` | `#F1F5F9` | Headings, code, active controls |
| Secondary Text | `--text-secondary` | `#CBD5E1` | Body copy, descriptions |
| Muted Text | `--text-muted` | `#94A3B8` | Table headers, inactive tabs, metadata |
| Legacy Accent | `--accent-legacy` | `#F59E0B` | LegacyMart baseline values & exit 2 |
| Modern Accent | `--accent-modern` | `#22D3EE` | ModernMart values, CLI commands, focus ring |
| Verified Pass | `--status-pass` | `#10B981` | Primary CTA, EQUIVALENT badge, exit 0 |
| Drift Fail | `--status-drift` | `#F43F5E` | Drifted values, diff deletions, exit 1 |

## Typography (`site/src/app/layout.tsx`)
- **Display:** `Bricolage Grotesque` (`600`, `700`, `800`), tracking `-0.025em` to `-0.03em`
- **Body:** `Public Sans` (`400`, `500`, `600`, `700`), body measure `46ch–64ch`
- **Code / Data:** `JetBrains Mono` (`400`, `500`, `600`, `700`) with `font-variant-numeric: tabular-nums` on all prices, hashes, and exit codes

## Craft Constraints Enforced
- Zero eyebrows/kickers above headings
- Zero 3-card icon grids or nested cards
- Zero gradient text, zero one-sided accent bars, zero ghost cards (1px border elevation only)
- Browser surfaces themed (`::selection`, `caret-color`, custom scrollbars, `:focus-visible`, `text-underline-offset`)
- One authored motion (`ledgerReveal` clip-path transition in `ConvergenceWorkbench.tsx`, respects `prefers-reduced-motion`)
