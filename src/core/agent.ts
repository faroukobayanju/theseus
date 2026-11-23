import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { FlowDiff } from "../types.js";
import { spawnResolved } from "../utils/spawn.js";

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_SNIPPET_BYTES = 64 * 1024;

export type AgentExecutor = (
  prompt: string,
  repoPath: string,
  agentCmd?: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type GitSnapshotFn = (
  repoPath: string,
) => Promise<{ commitSha: string; diff: string; changedFiles: string[] }>;

export function buildDriftPrompt(diffs: FlowDiff[], iter: number): string {
  const failing = diffs.filter((d) => !d.equivalent);
  const sections: string[] = [
    `# Behavioral Drift Report (Iteration ${iter})`,
    "",
    "The modern rewrite differs from the legacy baseline on the following flows.",
  ];

  for (const flow of failing) {
    sections.push("", `## Flow: ${flow.flowName} (\`${flow.flowId}\`)`);
    sections.push("| Kind | Key | Expected (Legacy) | Actual (Modern) |");
    sections.push("| --- | --- | --- | --- |");
    for (const d of flow.drifts) {
      sections.push(`| ${d.kind} | ${d.key ?? "-"} | ${d.expected} | ${d.actual} |`);
    }

    if (flow.modern.evidence.consoleErrors.length > 0) {
      sections.push("", "Modern console errors:");
      for (const err of flow.modern.evidence.consoleErrors) {
        sections.push(`- ${err}`);
      }
    }

    if (flow.modern.evidence.networkErrors.length > 0) {
      sections.push("", "Modern network errors:");
      for (const err of flow.modern.evidence.networkErrors) {
        sections.push(`- HTTP ${err.status} ${err.url}`);
      }
    }

    if ((flow.modern.evidence.bugsDetected ?? []).length > 0) {
      sections.push("", "Kane CLI native bug detections:");
      for (const bug of flow.modern.evidence.bugsDetected ?? []) {
        sections.push(`- ${bug.title}${bug.detail ? ` (${bug.detail})` : ""}`);
      }
    }
  }

  sections.push(
    "",
    "Fix the behavioral drift in the modern app without breaking other flows. Only inspect and edit files inside the current working directory, keep changes minimal, and finish immediately after applying the fix.",
  );
  return sections.join("\n");
}

export const invokeAgent: AgentExecutor = (prompt, repoPath, agentCmd) => {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    let child;

    if (agentCmd) {
      if (agentCmd.includes("{{prompt}}")) {
        if (isWin) {
          // PowerShell passes multi-line $env:THESEUS_PROMPT verbatim without cmd.exe newline splitting or metacharacter execution.
          const psCmd = agentCmd.replaceAll("{{prompt}}", "$env:THESEUS_PROMPT");
          child = spawn("powershell.exe", ["-NoProfile", "-Command", psCmd], {
            cwd: repoPath,
            env: { ...process.env, THESEUS_PROMPT: prompt },
            stdio: ["ignore", "pipe", "pipe"],
          });
        } else {
          const cmd = agentCmd.replaceAll("{{prompt}}", '"$THESEUS_PROMPT"');
          child = spawn("sh", ["-c", cmd], {
            cwd: repoPath,
            env: { ...process.env, THESEUS_PROMPT: prompt },
            stdio: ["ignore", "pipe", "pipe"],
          });
        }
      } else {
        child = isWin
          ? spawn(agentCmd, [], {
              cwd: repoPath,
              shell: true,
              stdio: ["pipe", "pipe", "pipe"],
            })
          : spawn("sh", ["-c", agentCmd], {
              cwd: repoPath,
              stdio: ["pipe", "pipe", "pipe"],
            });
        child.stdin?.end(prompt);
      }
    } else {
      // Pipe the multi-line drift prompt via stdin so Windows cmd/process args never mangle newlines or quotes.
      child = spawnResolved(
        "claude",
        ["-p", "--allowedTools", "Edit,Write,Read,Glob,Grep"],
        {
          cwd: repoPath,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stdin?.end(prompt);
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
};

async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

export const getGitSnapshot: GitSnapshotFn = async (repoPath) => {
  const shaOut = await runGit(["rev-parse", "HEAD"], repoPath);
  const commitSha = shaOut ? shaOut.trim() : "unknown";

  const diffOut =
    (await runGit(["diff", "HEAD", "--", "."], repoPath)) ??
    (await runGit(["diff", "--", "."], repoPath)) ??
    "";

  const statusOut = await runGit(["status", "--porcelain", "-uall", "--", "."], repoPath);
  const changedFiles: string[] = [];
  const untrackedSnippets: string[] = [];

  if (statusOut) {
    const gitTop = (await runGit(["rev-parse", "--show-toplevel"], repoPath))?.trim() ?? repoPath;
    for (const line of statusOut.split(/\r?\n/)) {
      if (line.length < 4) continue;
      const code = line.slice(0, 2);
      const filePart = line.slice(3).trim();
      const arrowIdx = filePart.indexOf(" -> ");
      const rawRelPath = arrowIdx >= 0 ? filePart.slice(arrowIdx + 4) : filePart;
      const relPath =
        rawRelPath.startsWith('"') && rawRelPath.endsWith('"')
          ? rawRelPath.slice(1, -1)
          : rawRelPath;
      changedFiles.push(relPath);

      if (code === "??") {
        try {
          const abs = resolve(gitTop, relPath);
          const info = await stat(abs);
          if (info.isFile() && info.size <= MAX_UNTRACKED_SNIPPET_BYTES) {
            const content = await readFile(abs, "utf8");
            untrackedSnippets.push(`diff --git a/${relPath} b/${relPath}\n+++ b/${relPath}\n${content}`);
          } else if (info.isFile()) {
            untrackedSnippets.push(
              `diff --git a/${relPath} b/${relPath}\n+++ b/${relPath}\n(omitted: ${info.size} bytes exceeds 64 KB preview limit)`,
            );
          }
        } catch {
          // ignore unreadable/directory entries
        }
      }
    }
  }

  const combinedDiff =
    untrackedSnippets.length > 0
      ? [diffOut, ...untrackedSnippets].filter(Boolean).join("\n")
      : diffOut;

  return { commitSha, diff: combinedDiff, changedFiles };
};
