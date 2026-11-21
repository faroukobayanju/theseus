import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { extractEvidence } from "../../src/kane/evidence.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("extractEvidence", () => {
  it("extracts last screenshot under screenshots/, console errors, and >=400 network errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-ev-"));
    dirs.push(dir);
    const zipPath = join(dir, "run.evidence");

    const zip = new AdmZip();
    zip.addFile("z-root.png", Buffer.from("root-png"));
    zip.addFile("screenshots/step-01.png", Buffer.from("first-step"));
    zip.addFile("screenshots/step-02-final.png", TINY_PNG);
    zip.addFile(
      "console.json",
      Buffer.from(
        JSON.stringify([
          { level: "info", message: "Booting app" },
          { level: "error", message: "TypeError: Cannot read properties of undefined" },
          { type: "error", text: "Unhandled promise rejection" },
        ]),
      ),
    );
    zip.addFile(
      "network.json",
      Buffer.from(
        JSON.stringify([
          { url: "http://localhost:3000/api/items", status: 200 },
          { url: "http://localhost:3000/api/checkout", status: 500 },
          { url: "http://localhost:3000/api/promo", statusCode: 404 },
        ]),
      ),
    );
    zip.writeZip(zipPath);

    const summary = await extractEvidence(zipPath);

    expect(summary.screenshotDataUri).toBe(
      `data:image/png;base64,${TINY_PNG.toString("base64")}`,
    );
    expect(summary.consoleErrors).toEqual([
      "TypeError: Cannot read properties of undefined",
      "Unhandled promise rejection",
    ]);
    expect(summary.networkErrors).toEqual([
      { url: "http://localhost:3000/api/checkout", status: 500 },
      { url: "http://localhost:3000/api/promo", status: 404 },
    ]);
  });

  it("falls back to root png and tolerates malformed json entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-ev-"));
    dirs.push(dir);
    const zipPath = join(dir, "partial.evidence");

    const zip = new AdmZip();
    zip.addFile("final.png", TINY_PNG);
    zip.addFile("console.json", Buffer.from("{not-valid-json"));
    zip.writeZip(zipPath);

    const summary = await extractEvidence(zipPath);

    expect(summary.screenshotDataUri).toBe(
      `data:image/png;base64,${TINY_PNG.toString("base64")}`,
    );
    expect(summary.consoleErrors).toEqual([]);
    expect(summary.networkErrors).toEqual([]);
  });

  it("returns empty summary without throwing for null, missing, or corrupt zip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-ev-"));
    dirs.push(dir);
    const corruptPath = join(dir, "corrupt.evidence");
    await writeFile(corruptPath, "not a zip archive at all");

    const empty = { screenshotDataUri: null, consoleErrors: [], networkErrors: [] };

    await expect(extractEvidence(null)).resolves.toEqual(empty);
    await expect(extractEvidence(join(dir, "does-not-exist.evidence"))).resolves.toEqual(empty);
    await expect(extractEvidence(corruptPath)).resolves.toEqual(empty);
  });
});
