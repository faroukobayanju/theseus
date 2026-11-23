import { ConvergenceWorkbench } from "@/components/ConvergenceWorkbench";
import { QuickstartPanel } from "@/components/QuickstartPanel";
import { SplitKeelMark } from "@/components/SplitKeelMark";

const GITHUB_URL = "https://github.com/faroukobayanju/theseus";

const LOOP_STEPS = [
  {
    name: "Capture the legacy answer key once",
    detail:
      "Plain-English flows from theseus.yaml run in real Chrome through kane-cli run --agent --headless. Extracted store as values, screenshots, console logs, and HAR traces cache under .theseus/baseline/.",
    artifact: ".theseus/baseline/<flow-id>.json",
    tone: "text-[#F59E0B]",
  },
  {
    name: "Diff behavior, never pixels",
    detail:
      "The same flows run against the rewritten app. Theseus compares extracted outputs, flow pass/fail status, and newly introduced console or HTTP 4xx–5xx errors. Redesign the entire UI without triggering false positives.",
    artifact: "Exit 0 equivalent · Exit 1 drift",
    tone: "text-[#F43F5E]",
  },
  {
    name: "Feed structured evidence back to your agent",
    detail:
      "Every failing field, expected legacy value, actual modern value, and Chrome network/console error goes straight to claude -p or any --agent-cmd runner. No manual copy-pasting from browser devtools.",
    artifact: "--agent-cmd 'opencode run --standalone --auto {{prompt}}'",
    tone: "text-[#22D3EE]",
  },
  {
    name: "Prove zero Hydra regressions and sign",
    detail:
      "Once failing flows pass, Theseus forces a full regression pass across every flow in the suite. Only a clean 100% pass emits a SHA-256 signed, self-contained HTML equivalence certificate.",
    artifact: ".theseus/report.html + .theseus/report.json",
    tone: "text-[#10B981]",
  },
];

const DRIFT_SPECIMEN = [
  {
    rule: "Discount before 8.25% tax",
    flow: "checkout-discount-tax",
    legacy: "$97.43",
    broken: "$98.25",
    fixed: "$97.43",
    cause: "Modern rewrite taxed full $100 subtotal before subtracting SAVE10.",
  },
  {
    rule: "Block promo stacking",
    flow: "promo-stacking-blocked",
    legacy: "Promo codes cannot be combined",
    broken: '"" (silent overwrite)',
    fixed: "Promo codes cannot be combined",
    cause: "Second code silently replaced active promo without returning error.",
  },
  {
    rule: "Enforce $10.00 minimum",
    flow: "minimum-order-enforced",
    legacy: "Minimum order is $10.00",
    broken: '"" (order placed)',
    fixed: "Minimum order is $10.00",
    cause: "Checkout validator checked subtotal <= 0 instead of subtotal < 10.",
  },
];

const CLI_COMMANDS = [
  {
    cmd: "theseus init",
    desc: "Scaffold theseus.yaml with legacy URL, modern URL, repo path, and plain-English flows.",
  },
  {
    cmd: "theseus baseline",
    desc: "Run all flows against the legacy app via Kane CLI and cache golden outputs + evidence.",
  },
  {
    cmd: "theseus verify",
    desc: "CI gate mode. Run modern app against cached baseline and exit 0, 1, or 2.",
  },
  {
    cmd: "theseus converge",
    desc: "Closed-loop agent patching, mandatory full regression pass, and signed HTML report.",
  },
  {
    cmd: "theseus demo",
    desc: "Boot bundled LegacyMart 2012 + ModernMart locally and converge all 3 planted drifts.",
  },
];

const SAMPLE_YAML = `legacyUrl: http://127.0.0.1:49494
modernUrl: http://127.0.0.1:49495
repoPath: ./examples/modern-shop
maxIterations: 3

flows:
  - id: checkout-discount-tax
    name: Checkout with SAVE10 discount before 8.25% tax
    storeKeys: [final_total]
    steps:
      - Add Widget Pro to cart
      - Enter SAVE10 in promo code input and click Apply
      - Read the Final Total text and store as final_total`;

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0B0F19]/92 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a
            href="#"
            className="inline-flex items-center gap-3 font-display text-base font-bold tracking-[0.06em] text-[#F1F5F9]"
          >
            <SplitKeelMark className="h-8 w-8" />
            <span>THESEUS</span>
          </a>

          <nav
            aria-label="Primary"
            className="flex items-center gap-6 text-sm text-[#94A3B8]"
          >
            <a href="#loop" className="hidden sm:inline hover:text-[#F1F5F9] transition-colors">
              Loop
            </a>
            <a href="#proof" className="hidden sm:inline hover:text-[#F1F5F9] transition-colors">
              Proof
            </a>
            <a href="#cli" className="hidden sm:inline hover:text-[#F1F5F9] transition-colors">
              CLI
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F1F5F9] transition-colors"
            >
              GitHub
            </a>
            <a
              href="#cli"
              className="inline-flex h-9 items-center rounded-lg bg-[#10B981] px-3.5 text-sm font-semibold text-[#04130D] transition-colors hover:bg-[#34D399]"
            >
              Run demo
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Viewport 1: Thesis + Live Workbench */}
        <section className="border-b border-[#1E293B]">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:py-24">
            <div className="space-y-6">
              <h1 className="font-display text-4xl font-extrabold leading-[1.06] tracking-[-0.03em] text-[#F1F5F9] sm:text-5xl lg:text-[3.35rem] text-balance">
                Rewrite every plank.{" "}
                <span className="text-[#22D3EE]">Prove nothing changed.</span>
              </h1>

              <p className="max-w-[54ch] text-base leading-relaxed text-[#CBD5E1] sm:text-lg">
                Theseus treats your running legacy web app as the answer key.
                Kane CLI executes the same plain-English flows on old and new in
                real Chrome, feeds behavioral drifts to your coding agent, and
                signs a SHA-256 certificate only when a full regression pass hits
                zero.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="#cli"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#10B981] px-5 text-sm font-semibold text-[#04130D] transition-colors hover:bg-[#34D399]"
                >
                  <span>Run bundled demo</span>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 8h9m0 0-3.5-3.5M12.5 8l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>

                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#334155] bg-[#111827] px-5 text-sm font-semibold text-[#F1F5F9] transition-colors hover:border-[#22D3EE] hover:text-[#22D3EE]"
                >
                  <span>Inspect source on GitHub</span>
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 font-mono text-xs text-[#94A3B8] tabular">
                <span>Node &gt;= 22</span>
                <span>Kane CLI 0.10.7</span>
                <span>Zero DB · Local CLI</span>
                <span>MIT License</span>
              </div>
            </div>

            <ConvergenceWorkbench />
          </div>
        </section>

        {/* Section 2: Closed Loop Architecture */}
        <section id="loop" className="border-b border-[#1E293B] py-20 lg:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="lg:sticky lg:top-24 lg:self-start space-y-5">
              <h2 className="font-display text-3xl font-bold tracking-[-0.025em] text-[#F1F5F9] sm:text-4xl text-balance">
                A closed loop where the browser is the judge.
              </h2>
              <p className="max-w-[46ch] text-base leading-relaxed text-[#CBD5E1]">
                Pixel diffs break the moment you modernize CSS. Hand-written
                assertions miss undocumented edge cases baked into a 12-year-old
                app. Running both apps side by side in Chrome turns legacy
                behavior into an executable specification.
              </p>

              <div className="rounded-xl border border-[#1E293B] bg-[#080C14] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#1E293B] px-4 py-2.5 font-mono text-xs text-[#94A3B8]">
                  <span>examples/theseus.demo.yaml</span>
                  <span className="text-[#F59E0B]">Plain-English flows</span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-[#CBD5E1]">
                  <code>{SAMPLE_YAML}</code>
                </pre>
              </div>
            </div>

            <ol className="divide-y divide-[#1E293B] border-y border-[#1E293B]">
              {LOOP_STEPS.map((step) => (
                <li key={step.name} className="py-7 first:pt-2 last:pb-2 space-y-2.5">
                  <h3 className="font-display text-xl font-bold tracking-[-0.015em] text-[#F1F5F9]">
                    {step.name}
                  </h3>
                  <p className="max-w-[64ch] text-sm leading-relaxed text-[#CBD5E1] sm:text-base">
                    {step.detail}
                  </p>
                  <div className={`font-mono text-xs pt-1 ${step.tone}`}>
                    {step.artifact}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Section 3: Bundled Demo Proof Ledger */}
        <section id="proof" className="border-b border-[#1E293B] bg-[#0E1424] py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-6 space-y-10">
            <div className="max-w-2xl space-y-3">
              <h2 className="font-display text-3xl font-bold tracking-[-0.025em] text-[#F1F5F9] sm:text-4xl text-balance">
                Three planted drifts. One live convergence.
              </h2>
              <p className="text-base leading-relaxed text-[#CBD5E1]">
                Running <code className="font-mono text-sm text-[#22D3EE]">theseus demo</code>{" "}
                boots LegacyMart 2012 and ModernMart on ephemeral localhost ports.
                ModernMart looks polished but ships three silent business-logic bugs
                that Kane CLI catches in real Chrome.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#1E293B] bg-[#080C14]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#1E293B] bg-[#111827] font-mono text-xs text-[#94A3B8]">
                    <th className="px-5 py-3.5 font-medium">Business Rule</th>
                    <th className="px-5 py-3.5 font-medium text-[#F59E0B]">
                      LegacyMart (Expected)
                    </th>
                    <th className="px-5 py-3.5 font-medium text-[#F43F5E]">
                      ModernMart (Drifted)
                    </th>
                    <th className="px-5 py-3.5 font-medium text-[#10B981]">
                      After Convergence
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] tabular">
                  {DRIFT_SPECIMEN.map((row) => (
                    <tr key={row.flow} className="align-top">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-[#F1F5F9]">{row.rule}</div>
                        <div className="mt-1 text-xs text-[#94A3B8] max-w-[36ch]">
                          {row.cause}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-[#FCD34D]">
                        {row.legacy}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-[#FDA4AF]">
                        {row.broken}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-[#6EE7B7]">
                        {row.fixed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Section 4: CLI Reference & Quickstart */}
        <section id="cli" className="py-20 lg:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
            <div className="space-y-6">
              <div className="space-y-3">
                <h2 className="font-display text-3xl font-bold tracking-[-0.025em] text-[#F1F5F9] sm:text-4xl text-balance">
                  Five commands. Pluggable agent. Zero lock-in.
                </h2>
                <p className="max-w-[50ch] text-base leading-relaxed text-[#CBD5E1]">
                  Works with Claude Code by default or any CLI coding agent via{" "}
                  <code className="font-mono text-sm text-[#22D3EE]">--agent-cmd</code>.
                  Deterministic exit codes drop directly into GitHub Actions or any CI pipeline.
                </p>
              </div>

              <dl className="divide-y divide-[#1E293B] border-y border-[#1E293B]">
                {CLI_COMMANDS.map((item) => (
                  <div
                    key={item.cmd}
                    className="grid gap-1 py-3.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className="font-mono text-xs font-semibold text-[#22D3EE] pt-0.5">
                      {item.cmd}
                    </dt>
                    <dd className="text-sm text-[#CBD5E1]">{item.desc}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <QuickstartPanel />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1E293B] bg-[#080C14]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-[#94A3B8]">
          <div className="inline-flex items-center gap-2.5">
            <SplitKeelMark className="h-6 w-6" />
            <span className="font-mono text-[#CBD5E1]">
              theseus-verify · Built for the TestMu AI KaneCLI Hackathon
            </span>
          </div>

          <div className="flex items-center gap-5 font-mono">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F1F5F9] transition-colors"
            >
              github.com/faroukobayanju/theseus
            </a>
            <span>MIT</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
