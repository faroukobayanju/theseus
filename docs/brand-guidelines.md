# Theseus Brand Guidelines

## Positioning & Tagline
- **Chosen Name:** **Theseus** (`theseus-verify` on npm, `theseus` CLI)
- **1-Line Tagline:** *Rewrite every plank. Prove nothing changed.*
- **Alternative Tagline:** *Your legacy app is the answer key.*

## Brand Voice Rules
1. **Evidence over adjectives.** Say `"Caught 3 drifts; converged in 1 iteration (SHA-256 verified)"`, never `"AI-powered seamless migration magic"`.
2. **Terminal-native & terse.** Short sentences, active verbs, exact numbers, exact exit codes (`0` equivalent, `1` drift, `2` setup error).
3. **Calm under fire.** Drift is data, not drama. State expected vs. actual cleanly.
4. **No AI slop.** Ban: *revolutionary, seamless, supercharge, harness, unlock, game-changer*.

## Color Direction

| Role | Token | Dark Mode (Primary) | Light Mode | Meaning |
|---|---|---|---|---|
| Canvas | `--bg-canvas` | `#0B0F19` | `#F8FAFC` | Deep obsidian / crisp paper |
| Surface | `--bg-surface` | `#111827` | `#FFFFFF` | Cards, report tables |
| Legacy Accent | `--accent-legacy` | `#F59E0B` (Amber) | `#B45309` | Old planks / baseline answer key |
| Modern Accent | `--accent-modern` | `#22D3EE` (Cyan) | `#0284C7` | New hull / rewritten app |
| Verified / Pass | `--status-pass` | `#10B981` (Emerald) | `#059669` | Equivalence proven / exit `0` |
| Drift / Fail | `--status-drift` | `#F43F5E` (Rose) | `#E11D48` | Behavioral drift / exit `1` |
| Primary Text | `--text-primary` | `#F1F5F9` | `#0F172A` | High-contrast body copy |

## Typography
- **UI & Headings:** `Inter`, system sans-serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
- **CLI, Diffs & Digests:** `JetBrains Mono`, `ui-monospace, SFMono-Regular, Menlo, monospace`

## Logo Usage
- Minimum size: `16px` (`assets/brand/favicon.svg`) for browser tabs; `32px+` for full Split Keel mark.
- Clear space: minimum `0.25×` mark width on all sides.
- Never add drop shadows, gradients, or distort aspect ratio.
