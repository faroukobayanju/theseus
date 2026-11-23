"use client";

import { useEffect, useState } from "react";

type PhaseId = "baseline" | "drift" | "patch" | "verified";

interface LedgerRow {
  flow: string;
  key: string;
  legacy: string;
  modern: string;
  status: "recorded" | "drift" | "patching" | "equivalent";
}

interface PhaseData {
  id: PhaseId;
  label: string;
  command: string;
  exitLabel: string;
  exitTone: "legacy" | "drift" | "modern" | "pass";
  summary: string;
  rows: LedgerRow[];
  diffLines?: { type: "ctx" | "del" | "add"; text: string }[];
  certificate?: {
    verdict: string;
    iterations: string;
    regression: string;
    digest: string;
  };
}

const PHASES: PhaseData[] = [
  {
    id: "baseline",
    label: "1. Baseline",
    command: "theseus baseline -c examples/theseus.demo.yaml",
    exitLabel: "3/3 RECORDED",
    exitTone: "legacy",
    summary:
      "Kane CLI runs 3 plain-English flows in headless Chrome against LegacyMart 2012 and caches extracted values + .evidence packs.",
    rows: [
      {
        flow: "checkout-discount-tax",
        key: "final_total",
        legacy: "$97.43",
        modern: "—",
        status: "recorded",
      },
      {
        flow: "promo-stacking-blocked",
        key: "promo_error",
        legacy: "Promo codes cannot be combined",
        modern: "—",
        status: "recorded",
      },
      {
        flow: "minimum-order-enforced",
        key: "checkout_error",
        legacy: "Minimum order is $10.00",
        modern: "—",
        status: "recorded",
      },
    ],
  },
  {
    id: "drift",
    label: "2. Drift Caught",
    command: "theseus verify --modern http://127.0.0.1:49495",
    exitLabel: "EXIT 1 · 3 DRIFTS",
    exitTone: "drift",
    summary:
      "Same flows run on ModernMart. Kane CLI catches tax-before-discount rounding ($0.82 off), silent promo overwrite, and missing $10 floor.",
    rows: [
      {
        flow: "checkout-discount-tax",
        key: "final_total",
        legacy: "$97.43",
        modern: "$98.25",
        status: "drift",
      },
      {
        flow: "promo-stacking-blocked",
        key: "promo_error",
        legacy: "Promo codes cannot be combined",
        modern: '""',
        status: "drift",
      },
      {
        flow: "minimum-order-enforced",
        key: "checkout_error",
        legacy: "Minimum order is $10.00",
        modern: '""',
        status: "drift",
      },
    ],
  },
  {
    id: "patch",
    label: "3. Agent Patch",
    command: "theseus converge --agent-cmd 'opencode run --standalone --auto {{prompt}}'",
    exitLabel: "ITER 1 · 1 FILE PATCHED",
    exitTone: "modern",
    summary:
      "Theseus sends the structured diff table + Kane console/HAR logs to the coding agent, which patches pricing.mjs in one iteration.",
    rows: [
      {
        flow: "checkout-discount-tax",
        key: "final_total",
        legacy: "$97.43",
        modern: "$97.43",
        status: "patching",
      },
      {
        flow: "promo-stacking-blocked",
        key: "promo_error",
        legacy: "Promo codes cannot be combined",
        modern: "Promo codes cannot be combined",
        status: "patching",
      },
      {
        flow: "minimum-order-enforced",
        key: "checkout_error",
        legacy: "Minimum order is $10.00",
        modern: "Minimum order is $10.00",
        status: "patching",
      },
    ],
    diffLines: [
      { type: "ctx", text: "@@ examples/modern-shop/pricing.mjs @@" },
      { type: "del", text: "- const tax = round2(cleanSubtotal * TAX_RATE);" },
      { type: "del", text: "- const total = round2(cleanSubtotal + tax - discount);" },
      { type: "add", text: "+ const discounted = round2(cleanSubtotal - discount);" },
      { type: "add", text: "+ const tax = round2(discounted * TAX_RATE);" },
      { type: "add", text: "+ const total = round2(discounted + tax);" },
    ],
  },
  {
    id: "verified",
    label: "4. Equivalent",
    command: "open .theseus/report.html",
    exitLabel: "EXIT 0 · EQUIVALENT",
    exitTone: "pass",
    summary:
      "Mandatory full regression pass re-runs all 3 flows from scratch to catch Hydra regressions, then signs .theseus/report.html.",
    rows: [
      {
        flow: "checkout-discount-tax",
        key: "final_total",
        legacy: "$97.43",
        modern: "$97.43",
        status: "equivalent",
      },
      {
        flow: "promo-stacking-blocked",
        key: "promo_error",
        legacy: "Promo codes cannot be combined",
        modern: "Promo codes cannot be combined",
        status: "equivalent",
      },
      {
        flow: "minimum-order-enforced",
        key: "checkout_error",
        legacy: "Minimum order is $10.00",
        modern: "Minimum order is $10.00",
        status: "equivalent",
      },
    ],
    certificate: {
      verdict: "EQUIVALENT",
      iterations: "1 iteration",
      regression: "3/3 full pass",
      digest: "sha256:9c4a7f2e81b0d54a...e31b",
    },
  },
];

const TONE_BADGE: Record<PhaseData["exitTone"], string> = {
  legacy: "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FCD34D]",
  drift: "border-[#F43F5E]/40 bg-[#F43F5E]/10 text-[#FDA4AF]",
  modern: "border-[#22D3EE]/40 bg-[#22D3EE]/10 text-[#67E8F9]",
  pass: "border-[#10B981]/40 bg-[#10B981]/10 text-[#6EE7B7]",
};

export function ConvergenceWorkbench() {
  const [phaseIdx, setPhaseIdx] = useState<number>(1);
  const [replaying, setReplaying] = useState<boolean>(false);

  useEffect(() => {
    if (!replaying) return;
    if (phaseIdx >= PHASES.length - 1) {
      const stopTimer = setTimeout(() => setReplaying(false), 1600);
      return () => clearTimeout(stopTimer);
    }
    const timer = setTimeout(() => {
      setPhaseIdx((prev) => Math.min(prev + 1, PHASES.length - 1));
    }, 1500);
    return () => clearTimeout(timer);
  }, [replaying, phaseIdx]);

  const phase = PHASES[phaseIdx];

  function handleReplay() {
    setPhaseIdx(0);
    setReplaying(true);
  }

  return (
    <div className="rounded-2xl border border-[#1E293B] bg-[#111827] overflow-hidden">
      {/* Phase selector bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] bg-[#080C14] px-4 py-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Convergence loop stages"
        >
          {PHASES.map((item, idx) => {
            const active = idx === phaseIdx;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setReplaying(false);
                  setPhaseIdx(idx);
                }}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-[#161F33] text-[#F1F5F9] border border-[#334155]"
                    : "text-[#94A3B8] hover:text-[#F1F5F9] border border-transparent"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleReplay}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#334155] bg-[#111827] px-2.5 py-1.5 font-mono text-xs font-medium text-[#22D3EE] transition-colors hover:border-[#22D3EE] cursor-pointer"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              d="M3 8a5 5 0 1 1 1.46 3.54M3 12V8.5h3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {replaying ? "Replaying..." : "Replay loop"}
        </button>
      </div>

      {/* Active command & verdict strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] bg-[#0D1322] px-4 py-3">
        <code className="font-mono text-xs text-[#CBD5E1] break-all">
          <span className="text-[#22D3EE] select-none">$ </span>
          {phase.command}
        </code>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide tabular ${TONE_BADGE[phase.exitTone]}`}
        >
          {phase.exitLabel}
        </span>
      </div>

      {/* Animated ledger body */}
      <div key={phase.id} className="ledger-reveal p-4 sm:p-5 space-y-4">
        <p className="text-sm text-[#CBD5E1] leading-relaxed">{phase.summary}</p>

        {/* Flow comparison table */}
        <div className="overflow-x-auto rounded-xl border border-[#1E293B] bg-[#080C14]">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-[#1E293B] text-[#94A3B8]">
                <th className="px-3 py-2.5 font-medium">Flow / Key</th>
                <th className="px-3 py-2.5 font-medium text-[#F59E0B]">
                  LegacyMart
                </th>
                <th className="px-3 py-2.5 font-medium text-[#22D3EE]">
                  ModernMart
                </th>
                <th className="px-3 py-2.5 font-medium text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B]/70 tabular">
              {phase.rows.map((row) => (
                <tr key={row.flow}>
                  <td className="px-3 py-2.5">
                    <div className="text-[#F1F5F9] font-medium">{row.flow}</div>
                    <div className="text-[11px] text-[#94A3B8]">{row.key}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[#FCD34D]">{row.legacy}</td>
                  <td
                    className={`px-3 py-2.5 ${
                      row.status === "drift"
                        ? "text-[#FDA4AF]"
                        : row.status === "equivalent"
                          ? "text-[#6EE7B7]"
                          : "text-[#CBD5E1]"
                    }`}
                  >
                    {row.modern}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {row.status === "recorded" && (
                      <span className="text-[#F59E0B]">CACHED</span>
                    )}
                    {row.status === "drift" && (
                      <span className="text-[#F43F5E] font-semibold">DRIFT</span>
                    )}
                    {row.status === "patching" && (
                      <span className="text-[#22D3EE]">RE-VERIFY</span>
                    )}
                    {row.status === "equivalent" && (
                      <span className="text-[#10B981] font-semibold">PASS</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Optional diff hunk for patch stage */}
        {phase.diffLines && (
          <pre className="overflow-x-auto rounded-xl border border-[#1E293B] bg-[#080C14] p-3.5 font-mono text-xs leading-relaxed">
            {phase.diffLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === "del"
                    ? "text-[#FDA4AF] bg-[#F43F5E]/10 px-1.5 -mx-1.5 rounded-xs"
                    : line.type === "add"
                      ? "text-[#6EE7B7] bg-[#10B981]/10 px-1.5 -mx-1.5 rounded-xs"
                      : "text-[#94A3B8]"
                }
              >
                {line.text}
              </div>
            ))}
          </pre>
        )}

        {/* Optional signed certificate strip for verified stage */}
        {phase.certificate && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#10B981]/35 bg-[#10B981]/8 px-3.5 py-3 font-mono text-xs tabular">
            <div className="flex items-center gap-2 text-[#6EE7B7] font-semibold">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M3.5 8.5 6.5 11.5 12.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{phase.certificate.verdict}</span>
              <span className="text-[#94A3B8] font-normal">
                · {phase.certificate.iterations} · {phase.certificate.regression}
              </span>
            </div>
            <span className="text-[#CBD5E1]">{phase.certificate.digest}</span>
          </div>
        )}
      </div>
    </div>
  );
}
