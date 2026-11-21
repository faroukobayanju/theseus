import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { TheseusConfigSchema, type TheseusConfig } from "./types.js";

export async function loadConfig(configPath: string): Promise<TheseusConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = parse(raw);
  return TheseusConfigSchema.parse(parsed);
}

export async function scaffoldConfig(
  targetPath: string,
  opts?: { legacyUrl?: string; modernUrl?: string; repoPath?: string },
): Promise<string> {
  const template: TheseusConfig = {
    legacyUrl: opts?.legacyUrl ?? "http://localhost:4101",
    modernUrl: opts?.modernUrl ?? "http://localhost:4102",
    repoPath: opts?.repoPath ?? ".",
    maxIters: 5,
    flows: [
      {
        id: "home-smoke",
        name: "Home page heading",
        objective:
          "Open {{url}}, read the main heading text, and store it as 'heading'",
        storeKeys: ["heading"],
      },
    ],
  };

  await writeFile(targetPath, stringify(template), "utf8");
  return targetPath;
}
