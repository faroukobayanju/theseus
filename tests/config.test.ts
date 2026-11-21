import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, scaffoldConfig } from "../src/config.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("config", () => {
  it("scaffolds a valid config and loads defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-cfg-"));
    dirs.push(dir);
    const file = join(dir, "theseus.yaml");

    await scaffoldConfig(file);
    const cfg = await loadConfig(file);

    expect(cfg.maxIters).toBe(5);
    expect(cfg.flows).toHaveLength(1);
    expect(cfg.flows[0].id).toBe("home-smoke");
  });

  it("rejects empty flows or invalid URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "theseus-cfg-"));
    dirs.push(dir);
    const file = join(dir, "bad.yaml");

    await writeFile(file, "legacyUrl: not-a-url\nmodernUrl: http://localhost:2\nflows: []\n");
    await expect(loadConfig(file)).rejects.toThrow();
  });
});
