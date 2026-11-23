import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { baseKeyName } from "../core/diff.js";
import type {
  DriftItem,
  EquivalenceReport,
  FlowDiff,
  IterationRecord,
  ReportVerdict,
} from "../types.js";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeDataImageUri(uri: string | null): string | null {
  if (!uri) return null;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null;
}

function verdictClass(verdict: ReportVerdict): string {
  switch (verdict) {
    case "EQUIVALENT":
      return "badge-pass";
    case "DRIFT":
      return "badge-fail";
    case "STUCK":
    case "MAX_ITERS":
      return "badge-warn";
  }
}

function renderStoredValuesTable(flow: FlowDiff): string {
  const keys = Array.from(
    new Set([
      ...Object.keys(flow.legacy.storedValues),
      ...Object.keys(flow.modern.storedValues),
    ]),
  ).sort();

  if (keys.length === 0) {
    return `<p class="muted">No stored values recorded.</p>`;
  }

  const driftedKeys = new Set(
    flow.drifts.map((d) => d.key).filter((k): k is string => Boolean(k)),
  );

  const rows = keys
    .map((key) => {
      const expected = flow.legacy.storedValues[key];
      const actual = flow.modern.storedValues[key];
      const match = expected !== undefined && actual !== undefined && expected.trim() === actual.trim();
      const base = baseKeyName(key);
      const isCollapsedAlias =
        !driftedKeys.has(key) &&
        !match &&
        ((base !== key && (flow.legacy.storedValues[base] !== undefined || flow.modern.storedValues[base] !== undefined)) ||
          flow.equivalent);
      const rowClass = match || isCollapsedAlias ? "row-match" : "row-diff";
      const label = match ? "MATCH" : isCollapsedAlias ? "IGNORED (ALIAS)" : "DRIFT";
      return `<tr class="${rowClass}">
        <td><code>${escapeHtml(key)}</code></td>
        <td><code>${expected !== undefined ? escapeHtml(expected) : "<em>missing</em>"}</code></td>
        <td><code>${actual !== undefined ? escapeHtml(actual) : "<em>missing</em>"}</code></td>
        <td>${label}</td>
      </tr>`;
    })
    .join("");

  return `<table>
    <thead><tr><th>Key</th><th>Legacy (Expected)</th><th>Modern (Actual)</th><th>State</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderDrifts(drifts: DriftItem[]): string {
  if (drifts.length === 0) return "";
  const items = drifts
    .map((d) => {
      const keyPart = d.key ? ` <code>${escapeHtml(d.key)}</code>` : "";
      return `<li><strong>${escapeHtml(d.kind)}</strong>${keyPart}: expected <code>${escapeHtml(d.expected)}</code>, got <code>${escapeHtml(d.actual)}</code></li>`;
    })
    .join("");
  return `<div class="drifts"><h4>Drifts (${drifts.length})</h4><ul>${items}</ul></div>`;
}

function renderScreenshots(flow: FlowDiff): string {
  const legacySrc = safeDataImageUri(flow.legacy.evidence.screenshotDataUri);
  const modernSrc = safeDataImageUri(flow.modern.evidence.screenshotDataUri);
  if (!legacySrc && !modernSrc) return "";

  const legacyBlock = legacySrc
    ? `<figure class="shot-legacy"><figcaption><span class="dot dot-legacy"></span>Legacy (Answer Key)</figcaption><img src="${escapeHtml(legacySrc)}" alt="Legacy screenshot for ${escapeHtml(flow.flowName)}" /></figure>`
    : `<figure class="shot-legacy"><figcaption><span class="dot dot-legacy"></span>Legacy (Answer Key)</figcaption><div class="no-shot">No screenshot</div></figure>`;
  const modernBlock = modernSrc
    ? `<figure class="shot-modern"><figcaption><span class="dot dot-modern"></span>Modern (Rewrite)</figcaption><img src="${escapeHtml(modernSrc)}" alt="Modern screenshot for ${escapeHtml(flow.flowName)}" /></figure>`
    : `<figure class="shot-modern"><figcaption><span class="dot dot-modern"></span>Modern (Rewrite)</figcaption><div class="no-shot">No screenshot</div></figure>`;

  return `<div class="shots">${legacyBlock}${modernBlock}</div>`;
}

function renderFlowCard(flow: FlowDiff): string {
  const stateBadge = flow.equivalent
    ? `<span class="badge badge-pass">EQUIVALENT</span>`
    : `<span class="badge badge-fail">DRIFT</span>`;

  return `<section class="card">
    <div class="card-head">
      <div>
        <h3>${escapeHtml(flow.flowName)} <span class="muted">(${escapeHtml(flow.flowId)})</span></h3>
        <div class="meta-line">Legacy: <code>${escapeHtml(flow.legacy.status)}</code> (${flow.legacy.durationMs}ms) &middot; Modern: <code>${escapeHtml(flow.modern.status)}</code> (${flow.modern.durationMs}ms)</div>
      </div>
      ${stateBadge}
    </div>
    ${renderStoredValuesTable(flow)}
    ${renderDrifts(flow.drifts)}
    ${renderScreenshots(flow)}
  </section>`;
}

function renderIterations(iterations: IterationRecord[]): string {
  if (iterations.length === 0) {
    return `<section class="card"><h2>Convergence Timeline</h2><p class="muted">No convergence iterations required.</p></section>`;
  }

  const items = iterations
    .map((it) => {
      const files = it.changedFiles.length > 0
        ? it.changedFiles.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")
        : `<span class="muted">none</span>`;
      const failing = it.failingFlowIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ");
      const diffBody = it.gitDiff.trim().length > 0 ? escapeHtml(it.gitDiff) : "(empty diff)";
      return `<div class="iter">
        <div class="iter-head">
          <strong>Iteration ${it.iter}</strong>
          <span class="muted">Failing flows: ${failing || "none"} &middot; Changed files: ${files}</span>
        </div>
        ${renderDrifts(it.drifts)}
        <details>
          <summary>Git Diff (${it.changedFiles.length} file${it.changedFiles.length === 1 ? "" : "s"})</summary>
          <pre><code>${diffBody}</code></pre>
        </details>
      </div>`;
    })
    .join("");

  return `<section class="card"><h2>Convergence Timeline</h2>${items}</section>`;
}

export function renderReportHtml(report: EquivalenceReport): string {
  const passedCount = report.flows.filter((f) => f.equivalent).length;
  const totalCount = report.flows.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Theseus Equivalence Certificate — ${escapeHtml(report.verdict)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0f19;
    --panel: #111827;
    --border: #1e293b;
    --border-strong: #334155;
    --text: #f1f5f9;
    --muted: #94a3b8;
    --legacy: #f59e0b;
    --modern: #22d3ee;
    --pass: #10b981;
    --fail: #f43f5e;
    --warn: #f59e0b;
    --code: #090d16;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 1.25rem 4rem;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.6 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 1100px; margin: 0 auto; display: grid; gap: 1.5rem; }
  header, .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
  }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  .brand-row { display: flex; align-items: center; gap: .85rem; }
  .brand-mark { width: 38px; height: 38px; flex-shrink: 0; }
  h1 { margin: 0 0 .2rem; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; }
  h2 { margin: 0 0 1rem; font-size: 1.05rem; font-weight: 600; letter-spacing: -0.01em; }
  h3 { margin: 0; font-size: 1rem; font-weight: 600; }
  h4 { margin: 1rem 0 .45rem; font-size: .88rem; color: var(--fail); }
  .muted { color: var(--muted); }
  .meta-line { color: var(--muted); font-size: .84rem; margin-top: .2rem; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: .3rem .75rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: .75rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .badge-pass { background: rgba(16, 185, 129, .14); color: #34d399; border: 1px solid rgba(16, 185, 129, .45); }
  .badge-fail { background: rgba(244, 63, 94, .14); color: #fb7185; border: 1px solid rgba(244, 63, 94, .45); }
  .badge-warn { background: rgba(245, 158, 11, .14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, .45); }
  .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .75rem; margin: 1.1rem 0 0; width: 100%; }
  .kv div { background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: .7rem .85rem; overflow-wrap: anywhere; }
  .kv dt { font-size: .7rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; }
  .kv dd { margin: .25rem 0 0; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; color: var(--text); }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: .86rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: .74rem; text-transform: uppercase; letter-spacing: .06em; }
  .row-diff td:last-child { color: #fb7185; font-weight: 700; }
  .row-match td:last-child { color: #34d399; font-weight: 700; }
  code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .83em; background: var(--code); border: 1px solid var(--border); padding: .12rem .38rem; border-radius: 5px; }
  pre { background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: .85rem; overflow-x: auto; margin: .6rem 0 0; }
  pre code { background: none; border: 0; padding: 0; font-size: .8rem; }
  .drifts ul { margin: .25rem 0 0; padding-left: 1.2rem; }
  .drifts li { margin: .3rem 0; }
  .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-top: 1.1rem; }
  figure { margin: 0; background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: .65rem; }
  figcaption { display: flex; align-items: center; gap: .45rem; font-size: .78rem; font-weight: 600; color: var(--muted); margin-bottom: .5rem; }
  .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
  .dot-legacy { background: var(--legacy); }
  .dot-modern { background: var(--modern); }
  figure img { width: 100%; height: auto; display: block; border-radius: 5px; border: 1px solid var(--border); }
  .no-shot { padding: 2.25rem 1rem; text-align: center; color: var(--muted); font-size: .84rem; }
  .iter { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem; }
  .iter:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
  .iter-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem; margin-bottom: .45rem; }
  details { margin-top: .55rem; }
  summary { cursor: pointer; color: var(--modern); font-size: .85rem; font-weight: 600; }
  summary:focus-visible { outline: 2px solid var(--modern); outline-offset: 2px; border-radius: 4px; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
</style>
</head>
<body>
<main>
  <header>
    <div class="brand-row">
      <svg class="brand-mark" viewBox="0 0 256 256" fill="none" aria-hidden="true">
        <rect width="256" height="256" rx="48" fill="#090D16"/>
        <path d="M40 70H118V96H52L40 70Z" fill="#F59E0B"/>
        <path d="M58 110H118V136H73L58 110Z" fill="#F59E0B"/>
        <path d="M78 150H118V176H93L78 150Z" fill="#F59E0B"/>
        <path d="M138 70H216L164 176H138V70Z" fill="#22D3EE"/>
        <path d="M100 190H156L128 222L100 190Z" fill="#10B981"/>
      </svg>
      <div>
        <h1>Theseus Behavioral Equivalence Certificate</h1>
        <div class="meta-line">Version ${escapeHtml(report.version)} &middot; ${passedCount}/${totalCount} flows equivalent &middot; Generated ${escapeHtml(report.generatedAt)}</div>
      </div>
    </div>
    <span class="badge ${verdictClass(report.verdict)}">${escapeHtml(report.verdict)}</span>
    <dl class="kv">
      <div><dt>Legacy URL</dt><dd>${escapeHtml(report.legacyUrl)}</dd></div>
      <div><dt>Modern URL</dt><dd>${escapeHtml(report.modernUrl)}</dd></div>
      <div><dt>Git Commit</dt><dd>${escapeHtml(report.gitCommitSha)}</dd></div>
      <div><dt>SHA-256 Digest</dt><dd>${escapeHtml(report.digest)}</dd></div>${
        report.mergedEvidencePath
          ? `\n      <div><dt>Merged Kane Evidence</dt><dd>${escapeHtml(report.mergedEvidencePath)}</dd></div>`
          : ""
      }${
        report.kaneFeaturesUsed && report.kaneFeaturesUsed.length > 0
          ? `\n      <div><dt>Kane CLI Features</dt><dd>${escapeHtml(report.kaneFeaturesUsed.join(" · "))}</dd></div>`
          : ""
      }
    </dl>
  </header>
  ${report.flows.map(renderFlowCard).join("\n  ")}
  ${renderIterations(report.iterations)}
</main>
</body>
</html>
`;
}

export async function writeReports(
  outDir: string,
  report: EquivalenceReport,
): Promise<{ jsonPath: string; htmlPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const htmlPath = join(outDir, "report.html");
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(htmlPath, renderReportHtml(report), "utf8"),
  ]);
  return { jsonPath, htmlPath };
}
