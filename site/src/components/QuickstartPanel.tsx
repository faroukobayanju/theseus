"use client";

import { useState } from "react";

type RunnerTab = "opencode" | "claude";

const COMMANDS: Record<RunnerTab, { label: string; note: string; snippet: string }> = {
  opencode: {
    label: "OpenCode (Free)",
    note: "Runs with zero paid API keys using OpenCode standalone mode.",
    snippet: `git clone https://github.com/faroukobayanju/theseus.git
cd theseus
npm install && npm run build
node dist/cli.js demo --agent-cmd "opencode run --standalone --auto {{prompt}}"`,
  },
  claude: {
    label: "Claude Code",
    note: "Default agent runner when claude CLI is authenticated.",
    snippet: `git clone https://github.com/faroukobayanju/theseus.git
cd theseus
npm install && npm run build
node dist/cli.js demo`,
  },
};

export function QuickstartPanel() {
  const [tab, setTab] = useState<RunnerTab>("opencode");
  const [copied, setCopied] = useState(false);

  const current = COMMANDS[tab];

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(current.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#1E293B] bg-[#111827] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] bg-[#080C14] px-4 py-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Agent runner">
          {(Object.keys(COMMANDS) as RunnerTab[]).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(key);
                  setCopied(false);
                }}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-[#161F33] text-[#F1F5F9] border border-[#334155]"
                    : "text-[#94A3B8] hover:text-[#F1F5F9] border border-transparent"
                }`}
              >
                {COMMANDS[key].label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={copySnippet}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#334155] bg-[#111827] px-2.5 py-1.5 font-mono text-xs text-[#CBD5E1] transition-colors hover:border-[#22D3EE] hover:text-[#22D3EE] cursor-pointer"
        >
          {copied ? "Copied" : "Copy commands"}
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <p className="text-sm text-[#94A3B8]">{current.note}</p>
        <pre className="overflow-x-auto rounded-xl border border-[#1E293B] bg-[#080C14] p-4 font-mono text-xs leading-6 text-[#F1F5F9]">
          <code>{current.snippet}</code>
        </pre>
        <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-xs tabular">
          <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/8 px-3 py-2">
            <div className="text-[#6EE7B7] font-semibold">Exit 0</div>
            <div className="text-[#CBD5E1] text-[11px] mt-0.5">Equivalent</div>
          </div>
          <div className="rounded-lg border border-[#F43F5E]/30 bg-[#F43F5E]/8 px-3 py-2">
            <div className="text-[#FDA4AF] font-semibold">Exit 1</div>
            <div className="text-[#CBD5E1] text-[11px] mt-0.5">Drift found</div>
          </div>
          <div className="rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3 py-2">
            <div className="text-[#FCD34D] font-semibold">Exit 2</div>
            <div className="text-[#CBD5E1] text-[11px] mt-0.5">Setup / auth</div>
          </div>
        </div>
      </div>
    </div>
  );
}
