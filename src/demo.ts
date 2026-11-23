import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DemoSuite = "shop" | "todomvc";

export interface RunningDemoServers {
  suite: DemoSuite;
  legacyUrl: string;
  modernUrl: string;
  configPath: string;
  repoPath: string;
  close: () => Promise<void>;
}

function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.unref();
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => rej(new Error("Failed to acquire ephemeral port")));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? rej(err) : res(port)));
    });
  });
}

export function resolvePackageRoot(rootDir?: string): string {
  if (rootDir) return resolve(rootDir);
  const cwd = process.cwd();
  if (existsSync(join(cwd, "examples", "legacy-shop", "server.mjs"))) {
    return cwd;
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(moduleDir, "..");
  if (existsSync(join(candidate, "examples", "legacy-shop", "server.mjs"))) {
    return candidate;
  }
  return resolve(moduleDir, "../..");
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((res) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 3000);
    forceTimer.unref();

    child.once("exit", () => {
      clearTimeout(forceTimer);
      res();
    });
    child.kill("SIGTERM");
  });
}

async function waitForHealth(
  url: string,
  child: ChildProcess,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Demo server exited early (code=${child.exitCode}, signal=${child.signalCode}) before ${url}/health became ready`,
      );
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Server not listening yet; retry shortly.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${url}/health after ${timeoutMs}ms`);
}

export async function startDemoServers(
  rootDir?: string,
  suite: DemoSuite = "shop",
): Promise<RunningDemoServers> {
  const baseDir = resolvePackageRoot(rootDir);
  const isTodo = suite === "todomvc";

  const legacyScript = isTodo
    ? join(baseDir, "benchmarks", "todomvc", "legacy", "server.mjs")
    : join(baseDir, "examples", "legacy-shop", "server.mjs");
  const modernScript = isTodo
    ? join(baseDir, "benchmarks", "todomvc", "modern", "server.mjs")
    : join(baseDir, "examples", "modern-shop", "server.mjs");
  const configPath = isTodo
    ? join(baseDir, "benchmarks", "todomvc", "theseus.yaml")
    : join(baseDir, "examples", "theseus.demo.yaml");
  const repoPath = isTodo
    ? join(baseDir, "benchmarks", "todomvc", "modern")
    : join(baseDir, "examples", "modern-shop");

  const [legacyPort, modernPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
  ]);

  const legacyUrl = `http://127.0.0.1:${legacyPort}`;
  const modernUrl = `http://127.0.0.1:${modernPort}`;

  const legacyChild = spawn(process.execPath, [legacyScript], {
    env: { ...process.env, PORT: String(legacyPort) },
    stdio: "ignore",
  });

  const modernChild = spawn(process.execPath, [modernScript], {
    env: { ...process.env, PORT: String(modernPort) },
    stdio: "ignore",
  });

  const close = async (): Promise<void> => {
    await Promise.all([stopChild(legacyChild), stopChild(modernChild)]);
  };

  try {
    await Promise.all([
      waitForHealth(legacyUrl, legacyChild),
      waitForHealth(modernUrl, modernChild),
    ]);
  } catch (err) {
    await close();
    throw err;
  }

  return { suite, legacyUrl, modernUrl, configPath, repoPath, close };
}
