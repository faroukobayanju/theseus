import {
  execFileSync,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
  useShell: boolean;
}

export interface ParsedShimTarget {
  kind: "node" | "exe";
  targetPath: string;
}

const resolutionCache = new Map<string, ResolvedCommand>();

/**
 * Parses an npm / pnpm / yarn generated Windows .cmd shim and extracts either
 * the underlying Node.js entrypoint (.cjs/.mjs/.js) or native binary (.exe) so
 * we can spawn it directly with `shell: false` (avoiding cmd.exe argument mangling).
 */
export function parseWindowsCmdShim(
  cmdContent: string,
  cmdDir: string,
  fileExists: (p: string) => boolean = existsSync,
): ParsedShimTarget | null {
  const patterns: Array<{ kind: "node" | "exe"; re: RegExp }> = [
    { kind: "node", re: /"(?:%~dp0|%dp0%|%_prog%)\\?([^"]+\.(?:cjs|mjs|js))"/i },
    { kind: "node", re: /(?:%~dp0|%dp0%)\\?([^\s"]+\.(?:cjs|mjs|js))/i },
    { kind: "exe", re: /"(?:%~dp0|%dp0%)\\?([^"]+\.exe)"/i },
    { kind: "exe", re: /(?:%~dp0|%dp0%)\\?([^\s"]+\.exe)/i },
  ];

  for (const { kind, re } of patterns) {
    const match = cmdContent.match(re);
    if (!match?.[1]) continue;
    const rel = match[1].replace(/^[\\/]+/, "").replace(/\\/g, "/");
    const candidate = resolve(cmdDir, rel);
    if (fileExists(candidate)) {
      return { kind, targetPath: candidate };
    }
  }
  return null;
}

export function resolveExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand {
  if (platform !== "win32") {
    return { command, prefixArgs: [], useShell: false };
  }

  const cacheKey = `${platform}:${command}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached) return cached;

  let candidates: string[] = [];
  try {
    const out = execFileSync("where.exe", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    candidates = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && existsSync(line));
  } catch {
    candidates = [];
  }

  // Prefer a native .exe first (e.g. claude.exe) — zero shell overhead or quoting issues.
  const exeMatch = candidates.find((p) => /\.exe$/i.test(p));
  if (exeMatch) {
    const res: ResolvedCommand = { command: exeMatch, prefixArgs: [], useShell: false };
    resolutionCache.set(cacheKey, res);
    return res;
  }

  // Next, unwrap npm/pnpm .cmd shims to invoke Node (.cjs/.js) or the wrapped .exe directly.
  const cmdMatch = candidates.find((p) => /\.(?:cmd|bat)$/i.test(p));
  if (cmdMatch) {
    try {
      const content = readFileSync(cmdMatch, "utf8");
      const shimTarget = parseWindowsCmdShim(content, dirname(cmdMatch));
      if (shimTarget) {
        const res: ResolvedCommand =
          shimTarget.kind === "exe"
            ? { command: shimTarget.targetPath, prefixArgs: [], useShell: false }
            : { command: process.execPath, prefixArgs: [shimTarget.targetPath], useShell: false };
        resolutionCache.set(cacheKey, res);
        return res;
      }
    } catch {
      // Fall through to shell execution of the .cmd shim.
    }
    const res: ResolvedCommand = { command: cmdMatch, prefixArgs: [], useShell: true };
    resolutionCache.set(cacheKey, res);
    return res;
  }

  // Fallback on Windows when `where.exe` didn't locate it (let cmd resolve PATH).
  const fallback: ResolvedCommand = { command, prefixArgs: [], useShell: true };
  return fallback;
}

export function spawnResolved(
  command: string,
  args: string[],
  options: SpawnOptions = {},
  spawnFn: typeof spawn = spawn,
): ChildProcess {
  // When a custom mock spawnFn is injected in tests, preserve the exact command/args contract.
  if (spawnFn !== spawn) {
    return spawnFn(command, args, options);
  }
  const resolved = resolveExecutable(command);
  return spawnFn(resolved.command, [...resolved.prefixArgs, ...args], {
    ...options,
    shell: options.shell ?? resolved.useShell,
  });
}

export function clearResolutionCache(): void {
  resolutionCache.clear();
}
