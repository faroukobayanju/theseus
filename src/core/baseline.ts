import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaneRunResult } from "../types.js";

export interface BaselineData {
  legacyUrl: string;
  recordedAt: string;
  results: Record<string, KaneRunResult>;
}

function baselinePath(baseDir: string): string {
  const isDotTheseus = path.basename(path.resolve(baseDir)) === ".theseus";
  return isDotTheseus
    ? path.join(baseDir, "baseline", "baseline.json")
    : path.join(baseDir, ".theseus", "baseline", "baseline.json");
}

export async function saveBaseline(
  baseDir: string,
  legacyUrl: string,
  results: KaneRunResult[],
): Promise<string> {
  const filePath = baselinePath(baseDir);
  await mkdir(path.dirname(filePath), { recursive: true });

  const byFlow: Record<string, KaneRunResult> = {};
  for (const res of results) {
    byFlow[res.flowId] = res;
  }

  const data: BaselineData = {
    legacyUrl,
    recordedAt: new Date().toISOString(),
    results: byFlow,
  };

  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

export async function loadBaseline(baseDir: string): Promise<BaselineData | null> {
  try {
    const raw = await readFile(baselinePath(baseDir), "utf8");
    return JSON.parse(raw) as BaselineData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}
