import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBaseline, saveBaseline } from "../../src/core/baseline.js";
import type { KaneRunResult } from "../../src/types.js";

function makeResult(flowId: string, total: string): KaneRunResult {
  return {
    flowId,
    targetUrl: "http://localhost:3001",
    exitCode: 0,
    status: "passed",
    storedValues: { final_total: total },
    summary: "ok",
    evidencePath: null,
    evidence: { screenshotDataUri: null, consoleErrors: [], networkErrors: [] },
    durationMs: 120,
  };
}

describe("baseline cache", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("returns null when baseline file is absent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "theseus-base-"));
    tempDirs.push(dir);
    expect(await loadBaseline(dir)).toBeNull();
  });

  it("round-trips saveBaseline and loadBaseline", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "theseus-base-"));
    tempDirs.push(dir);

    const r1 = makeResult("flow-a", "$97.43");
    const r2 = makeResult("flow-b", "Promo codes cannot be combined");
    const savedPath = await saveBaseline(dir, "http://localhost:3001", [r1, r2]);

    expect(savedPath).toBe(path.join(dir, ".theseus", "baseline", "baseline.json"));

    const loaded = await loadBaseline(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.legacyUrl).toBe("http://localhost:3001");
    expect(typeof loaded?.recordedAt).toBe("string");
    expect(loaded?.results["flow-a"]).toEqual(r1);
    expect(loaded?.results["flow-b"]).toEqual(r2);
  });

  it("does not double-nest .theseus/.theseus when baseDir already ends with .theseus", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "theseus-base-"));
    tempDirs.push(root);
    const dotTheseus = path.join(root, ".theseus");

    const savedPath = await saveBaseline(dotTheseus, "http://localhost:3001", [
      makeResult("flow-a", "$97.43"),
    ]);

    expect(savedPath).toBe(path.join(dotTheseus, "baseline", "baseline.json"));
    const loaded = await loadBaseline(dotTheseus);
    expect(loaded?.results["flow-a"].storedValues.final_total).toBe("$97.43");
  });
});
