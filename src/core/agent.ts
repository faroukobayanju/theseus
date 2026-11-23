import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { FlowDiff } from "../types.js";

const execFileAsync = promisify(execFile);

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
  }

  sections.push(
    "",
    "Fix the behavioral drift in the modern app without breaking other flows. Only inspect and edit files inside the current working directory, keep changes minimal, and finish immediately after applying the fix.",
  );
  return sections.join("\n");
}

export const invokeAgent: AgentExecutor = (prompt, repoPath, agentCmd) => {
  return new Promise((resolve, reject) => {
    let child;
    if (agentCmd) {
      if (agentCmd.includes("{{prompt}}")) {
        const cmd = agentCmd.replaceAll("{{prompt}}", '"$THESEUS_PROMPT"');
        child = spawn("sh", ["-c", cmd], {
          cwd: repoPath,
          env: { ...process.env, THESEUS_PROMPT: prompt },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        child = spawn("sh", ["-c", agentCmd], {
          cwd: repoPath,
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdin?.end(prompt);
      }
    } else {
      child = spawn(
        "claude",
        ["-p", prompt, "--allowedTools", "Edit,Write,Read,Glob,Grep"],
        {
          cwd: repoPath,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
    (await runGit(["diff", "HEAD"], repoPath)) ??
    (await runGit(["diff"], repoPath)) ??
    "";

  const statusOut = await runGit(["status", "--porcelain"], repoPath);
  const changedFiles = statusOut
    ? statusOut
        .split(/\r?\n/)
        .filter((line) => line.length >= 4)
        .map((line) => {
          const filePart = line.slice(3).trim();
          const arrowIdx = filePart.indexOf(" -> ");
          return arrowIdx >= 0 ? filePart.slice(arrowIdx + 4) : filePart;
        })
    : [];

  return { commitSha, diff: diffOut, changedFiles };
};
