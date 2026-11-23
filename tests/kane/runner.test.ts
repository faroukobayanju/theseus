import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKaneArgs, parseNdjsonStream, runKaneFlow } from "../../src/kane/runner.js";
import type { FlowSpec } from "../../src/types.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const SAMPLE_FLOW: FlowSpec = {
  id: "discount-tax-rounding",
  name: "Discount + Tax Rounding",
  objective: "Go to {{url}}, apply SAVE10, and store total as 'final_total'",
  storeKeys: ["final_total"],
};

function createMockSpawn(chunks: string[], exitCode: number, emitError?: Error) {
  const calls: Array<{ cmd: string; args: string[] }> = [];

  const mockSpawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = stdout;
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = stderr;
    child.kill = vi.fn(() => true);

    queueMicrotask(() => {
      if (emitError) {
        child.emit("error", emitError);
        return;
      }
      for (const chunk of chunks) {
        stdout.emit("data", Buffer.from(chunk));
      }
      child.emit("close", exitCode);
    });

    return child;
  }) as unknown as typeof spawn;

  return { mockSpawn, calls };
}

describe("parseNdjsonStream", () => {
  it("ignores noisy non-JSON lines and extracts stored values, summary, and evidencePath", () => {
    const raw = [
      "Kane CLI v1.2.3 — update available!",
      "",
      "{partial broken json",
      JSON.stringify({ type: "store", key: "final_total", value: "$97.43" }),
      JSON.stringify({ type: "step", variables: { promo_code: "SAVE10" } }),
      JSON.stringify({ type: "step", extracted: { tax_amount: "$7.43" } }),
      "plain text log line",
      JSON.stringify({
        type: "run_end",
        storedValues: { subtotal: "$90.00" },
        summary: "Flow passed",
        evidence_path: "/tmp/run-1.evidence",
      }),
    ].join("\n");

    const parsed = parseNdjsonStream(raw);

    expect(parsed.storedValues).toEqual({
      final_total: "$97.43",
      promo_code: "SAVE10",
      tax_amount: "$7.43",
      subtotal: "$90.00",
    });
    expect(parsed.summary).toBe("Flow passed");
    expect(parsed.evidencePath).toBe("/tmp/run-1.evidence");
  });
});

describe("runKaneFlow", () => {
  it("handles chunked NDJSON split mid-line, injects targetUrl, emits events, and unpacks evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-run-"));
    dirs.push(dir);
    const zipPath = join(dir, "out.evidence");
    const zip = new AdmZip();
    zip.addFile("screenshots/end.png", Buffer.from("png-bytes"));
    zip.writeZip(zipPath);

    const endEvent = JSON.stringify({
      type: "run_end",
      storedValues: { final_total: "$97.43" },
      summary: "All checks passed",
      evidencePath: zipPath,
    });
    const splitAt = Math.floor(endEvent.length / 2);

    const chunks = [
      "Banner line before JSON\n{\"type\":\"step\"",
      ",\"step\":1}\nnot-json\n",
      endEvent.slice(0, splitAt),
      endEvent.slice(splitAt), // no trailing newline on final chunk
    ];

    const { mockSpawn, calls } = createMockSpawn(chunks, 0);
    const seenEvents: Array<Record<string, unknown>> = [];

    const result = await runKaneFlow(SAMPLE_FLOW, "http://localhost:4100", {
      spawnFn: mockSpawn,
      onEvent: (ev) => seenEvents.push(ev),
    });

    expect(calls).toEqual([
      {
        cmd: "kane-cli",
        args: [
          "run",
          "Go to http://localhost:4100, apply SAVE10, and store total as 'final_total'",
          "--agent",
          "--headless",
        ],
      },
    ]);
    expect(seenEvents).toHaveLength(2);
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.storedValues).toEqual({ final_total: "$97.43" });
    expect(result.summary).toBe("All checks passed");
    expect(result.evidencePath).toBe(zipPath);
    expect(result.evidence.screenshotDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it.each([
    [0, "passed"],
    [1, "failed"],
    [2, "setup_error"],
    [3, "timeout"],
  ] as const)("maps exit code %i to status %s", async (code, expectedStatus) => {
    const { mockSpawn } = createMockSpawn(
      [JSON.stringify({ type: "run_end", summary: `code ${code}` }) + "\n"],
      code,
    );

    const result = await runKaneFlow(SAMPLE_FLOW, "http://localhost:4100", {
      spawnFn: mockSpawn,
    });

    expect(result.exitCode).toBe(code);
    expect(result.status).toBe(expectedStatus);
  });

  it("maps spawn error to setup_error with exit code 2", async () => {
    const { mockSpawn } = createMockSpawn([], 0, new Error("spawn kane-cli ENOENT"));

    const result = await runKaneFlow(SAMPLE_FLOW, "http://localhost:4100", {
      spawnFn: mockSpawn,
    });

    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("setup_error");
    expect(result.summary).toContain("ENOENT");
  });

  it("wires full Kane CLI flags (assertion-mode, final-validation, bug-detection, variables) and testmd run", () => {
    const inlineArgs = buildKaneArgs(
      {
        ...SAMPLE_FLOW,
        variables: { promo: { value: "SAVE10" } },
      },
      "http://127.0.0.1:4101",
      {
        kaneSettings: {
          assertionMode: "dom",
          finalValidation: true,
          bugDetection: "continue",
          maxSteps: 30,
        },
      },
    );
    expect(inlineArgs).toEqual([
      "run",
      "Go to http://127.0.0.1:4101, apply SAVE10, and store total as 'final_total'",
      "--agent",
      "--headless",
      "--assertion-mode",
      "dom",
      "--final-validation",
      "on",
      "--bug-detection",
      "continue",
      "--max-steps",
      "30",
      "--variables",
      JSON.stringify({ promo: { value: "SAVE10" } }),
    ]);

    const testmdArgs = buildKaneArgs(
      {
        id: "checkout-md",
        name: "Checkout test.md",
        testmdPath: "flows/checkout_test.md",
        storeKeys: ["final_total"],
      },
      "http://127.0.0.1:4102",
      { kaneSettings: { bugDetection: "continue" } },
    );
    expect(testmdArgs).toEqual([
      "testmd",
      "run",
      "flows/checkout_test.md",
      "--override-start-url",
      "http://127.0.0.1:4102",
      "--local",
      "--agent",
      "--headless",
      "--bug-detection",
      "continue",
    ]);
  });

  it("extracts Kane native bug detections from NDJSON stream", () => {
    const raw = [
      JSON.stringify({
        type: "bug_detected",
        bug: { title: "Clear completed deleted active todos", severity: "high" },
      }),
      JSON.stringify({ type: "run_end", summary: "done" }),
    ].join("\n");

    const parsed = parseNdjsonStream(raw);
    expect(parsed.bugsDetected).toEqual([
      { title: "Clear completed deleted active todos", severity: "high", detail: undefined },
    ]);
  });
});
