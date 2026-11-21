import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  const rows = keys
    .map((key) => {
      const expected = flow.legacy.storedValues[key];
      const actual = flow.modern.storedValues[key];
      const match = expected !== undefined && actual !== undefined && expected.trim() === actual.trim();
      const rowClass = match ? "row-match" : "row-diff";
      return `<tr class="${rowClass}">
        <td><code>${escapeHtml(key)}</code></td>
        <td><code>${expected !== undefined ? escapeHtml(expected) : "<em>missing</em>"}</code></td>
        <td><code>${actual !== undefined ? escapeHtml(actual) : "<em>missing</em>"}</code></td>
        <td>${match ? "MATCH" : "DRIFT"}</td>
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
    ? `<figure><figcaption>Legacy</figcaption><img src="${escapeHtml(legacySrc)}" alt="Legacy screenshot for ${escapeHtml(flow.flowName)}" /></figure>`
    : `<figure><figcaption>Legacy</figcaption><div class="no-shot">No screenshot</div></figure>`;
  const modernBlock = modernSrc
    ? `<figure><figcaption>Modern</figcaption><img src="${escapeHtml(modernSrc)}" alt="Modern screenshot for ${escapeHtml(flow.flowName)}" /></figure>`
    : `<figure><figcaption>Modern</figcaption><div class="no-shot">No screenshot</div></figure>`;

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
  :root { color-scheme: dark; --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3; --muted: #8b949e; --pass: #2ea043; --fail: #f85149; --warn: #d29922; --code: #0b0f14; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.25rem; background: var(--bg); color: var(--text); font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; display: grid; gap: 1.25rem; }
  header, .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  h1 { margin: 0 0 .35rem; font-size: 1.4rem; }
  h2 { margin: 0 0 .85rem; font-size: 1.1rem; }
  h3 { margin: 0; font-size: 1rem; }
  h4 { margin: .85rem 0 .4rem; font-size: .9rem; color: var(--fail); }
  .muted { color: var(--muted); }
  .meta-line { color: var(--muted); font-size: .85rem; margin-top: .25rem; }
  .badge { display: inline-block; padding: .25rem .65rem; border-radius: 999px; font-weight: 700; font-size: .78rem; letter-spacing: .04em; }
  .badge-pass { background: rgba(46,160,67,.18); color: #56d364; border: 1px solid var(--pass); }
  .badge-fail { background: rgba(248,81,73,.18); color: #ff7b72; border: 1px solid var(--fail); }
  .badge-warn { background: rgba(210,153,34,.18); color: #e3b341; border: 1px solid var(--warn); }
  .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .75rem; margin-top: 1rem; width: 100%; }
  .kv div { background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: .6rem .75rem; overflow-wrap: anywhere; }
  .kv dt { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .kv dd { margin: .2rem 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: .9rem; }
  table { width: 100%; border-collapse: collapse; font-size: .86rem; }
  th, td { text-align: left; padding: .5rem .65rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
  .row-diff td:last-child { color: #ff7b72; font-weight: 600; }
  .row-match td:last-child { color: #56d364; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .84em; background: var(--code); padding: .1rem .3rem; border-radius: 4px; }
  pre { background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: .75rem; overflow-x: auto; margin: .5rem 0 0; }
  pre code { background: none; padding: 0; font-size: .8rem; }
  .drifts ul { margin: .25rem 0 0; padding-left: 1.2rem; }
  .drifts li { margin: .25rem 0; }
  .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: .9rem; margin-top: 1rem; }
  figure { margin: 0; background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: .5rem; }
  figcaption { font-size: .78rem; color: var(--muted); margin-bottom: .4rem; }
  figure img { width: 100%; height: auto; display: block; border-radius: 4px; }
  .no-shot { padding: 2rem 1rem; text-align: center; color: var(--muted); font-size: .85rem; }
  .iter { border-top: 1px solid var(--border); padding-top: .85rem; margin-top: .85rem; }
  .iter:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
  .iter-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem; margin-bottom: .4rem; }
  details { margin-top: .5rem; }
  summary { cursor: pointer; color: #79c0ff; font-size: .86rem; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Theseus Behavioral Equivalence Certificate</h1>
      <div class="meta-line">Version ${escapeHtml(report.version)} &middot; ${passedCount}/${totalCount} flows equivalent &middot; Generated ${escapeHtml(report.generatedAt)}</div>
    </div>
    <span class="badge ${verdictClass(report.verdict)}">${escapeHtml(report.verdict)}</span>
    <dl class="kv">
      <div><dt>Legacy URL</dt><dd>${escapeHtml(report.legacyUrl)}</dd></div>
      <div><dt>Modern URL</dt><dd>${escapeHtml(report.modernUrl)}</dd></div>
      <div><dt>Git Commit</dt><dd>${escapeHtml(report.gitCommitSha)}</dd></div>
      <div><dt>SHA-256 Digest</dt><dd>${escapeHtml(report.digest)}</dd></div>
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
