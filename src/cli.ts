import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { stringify } from "yaml";
import { loadConfig, scaffoldConfig } from "./config.js";
import { loadBaseline, saveBaseline } from "./core/baseline.js";
import { runConvergeLoop } from "./core/converge.js";
import { diffFlowResult } from "./core/diff.js";
import { resolvePackageRoot, startDemoServers, type DemoSuite } from "./demo.js";
import { checkKaneAuth, exploreAppForFlows } from "./kane/packs.js";
import { runKaneFlow } from "./kane/runner.js";
import { writeReports } from "./report/html.js";
import { computeEquivalenceDigest } from "./report/signer.js";
import {
  SetupError,
  type EquivalenceReport,
  type FlowDiff,
  type KaneRunResult,
  type TheseusConfig,
} from "./types.js";

const DEFAULT_BASE_DIR = ".theseus";

function handleError(err: unknown): never {
  if (err instanceof SetupError) {
    console.error(pc.red(`Setup error: ${err.message}`));
    process.exit(2);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(pc.red(`Error: ${msg}`));
  process.exit(2);
}

function printFlowSummary(diffs: FlowDiff[]): void {
  for (const d of diffs) {
    const badge = d.equivalent ? pc.green("PASS") : pc.red("DRIFT");
    console.log(`  ${badge} ${d.flowName} (${d.flowId})`);
    for (const drift of d.drifts) {
      const keyPart = drift.key ? ` [${drift.key}]` : "";
      console.log(
        `        ${pc.yellow(drift.kind)}${keyPart}: expected ${pc.cyan(drift.expected)} | actual ${pc.red(drift.actual)}`,
      );
    }
  }
}

function printReportFooter(
  report: EquivalenceReport,
  paths: { htmlPath: string; jsonPath: string },
): void {
  printFlowSummary(report.flows);
  console.log(`\nVerdict: ${report.verdict === "EQUIVALENT" ? pc.green(report.verdict) : pc.red(report.verdict)}`);
  console.log(`Digest:  ${pc.cyan(report.digest)}`);
  if (report.mergedEvidencePath) {
    console.log(`Pack:    ${pc.cyan(report.mergedEvidencePath)}`);
  }
  if (report.kaneFeaturesUsed && report.kaneFeaturesUsed.length > 0) {
    console.log(`Kane:    ${pc.dim(report.kaneFeaturesUsed.join(" | "))}`);
  }
  console.log(`Report:  ${paths.htmlPath}`);
  console.log(`JSON:    ${paths.jsonPath}`);
}

async function captureBaseline(configPath: string, baseDir: string): Promise<void> {
  const config = await loadConfig(configPath);
  console.log(pc.bold(`Capturing legacy baseline from ${config.legacyUrl}...`));
  const results: KaneRunResult[] = [];
  for (const flow of config.flows) {
    console.log(`  • ${flow.name}`);
    const res = await runKaneFlow(flow, config.legacyUrl, { kaneSettings: config.kane });
    if (res.status === "setup_error") {
      throw new SetupError(`Kane CLI setup/auth error on flow "${flow.id}": ${res.summary}`);
    }
    results.push(res);
  }
  const saved = await saveBaseline(baseDir, config.legacyUrl, results);
  console.log(pc.green(`Baseline cached at ${saved}`));
}

async function runReplayDemo(suite: DemoSuite): Promise<void> {
  const pkgRoot = resolvePackageRoot();
  const evidenceFile =
    suite === "todomvc"
      ? join(pkgRoot, "benchmarks", "todomvc", "evidence", "report.json")
      : join(pkgRoot, "benchmarks", "demo-shop", "evidence", "report.json");

  if (!existsSync(evidenceFile)) {
    throw new SetupError(
      `Committed replay evidence not found at ${evidenceFile}. Run live mode without --replay.`,
    );
  }

  const report = JSON.parse(await readFile(evidenceFile, "utf8")) as EquivalenceReport;
  console.log(pc.bold(pc.cyan(`\nTheseus Instant Replay (${suite}) — real committed Kane CLI + Claude run`)));
  console.log(pc.dim(`Recorded at: ${report.generatedAt} | Commit: ${report.gitCommitSha}\n`));

  if (report.iterations.length > 0) {
    console.log(pc.bold("Initial Drifts Detected by Kane CLI:"));
    for (const iter of report.iterations) {
      console.log(pc.yellow(`  Iteration ${iter.iter}: ${iter.drifts.length} drift(s) across ${iter.failingFlowIds.length} flow(s)`));
      for (const d of iter.drifts) {
        const keyPart = d.key ? ` [${d.key}]` : "";
        console.log(`    • ${d.flowId}${keyPart}: expected ${pc.cyan(d.expected)} | actual ${pc.red(d.actual)}`);
      }
      console.log(pc.green(`    → Agent patched: ${iter.changedFiles.join(", ") || "(in-place)"}`));
    }
    console.log("");
  }

  console.log(pc.bold("Final Post-Convergence Regression Verification:"));
  const paths = await writeReports(DEFAULT_BASE_DIR, report);
  printReportFooter(report, paths);
  process.exit(report.verdict === "EQUIVALENT" ? 0 : 1);
}

const program = new Command();
program
  .name("theseus")
  .description("Rewrite a legacy web app and prove behavioral equivalence with Kane CLI")
  .version("0.2.0");

program
  .command("init")
  .description("Scaffold a theseus.yaml config with full Kane CLI verification flags")
  .option("-o, --output <path>", "Output config path", "theseus.yaml")
  .option("--legacy <url>", "Legacy app URL")
  .option("--modern <url>", "Modern app URL")
  .option("--repo <path>", "Modern app repo path")
  .action(async (opts) => {
    try {
      const out = await scaffoldConfig(opts.output, {
        legacyUrl: opts.legacy,
        modernUrl: opts.modern,
        repoPath: opts.repo,
      });
      console.log(pc.green(`Created ${out}`));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("discover")
  .description("Use `kane-cli explore` to auto-discover legacy app flows into theseus.yaml")
  .requiredOption("--legacy <url>", "Legacy app URL to explore")
  .option("--modern <url>", "Modern app URL", "http://127.0.0.1:4102")
  .option("--repo <path>", "Modern app repo path", ".")
  .option("--project <id>", "TestMu AI Test Manager project id")
  .option("--prompt <text>", "Exploration guidance prompt")
  .option("--max-leases <n>", "Max exploration leases", (v) => Number.parseInt(v, 10), 8)
  .option("-o, --output <path>", "Output config path", "theseus.yaml")
  .action(async (opts) => {
    try {
      console.log(pc.bold(`Running kane-cli explore against ${opts.legacy}...`));
      const res = await exploreAppForFlows(opts.legacy, {
        project: opts.project,
        prompt: opts.prompt,
        maxLeases: opts.maxLeases,
      });
      if (res.exitCode !== 0 && res.flows.length === 0) {
        throw new SetupError(`kane-cli explore exited with code ${res.exitCode}: ${res.stderr.trim()}`);
      }
      const cfg: TheseusConfig = {
        legacyUrl: opts.legacy,
        modernUrl: opts.modern,
        repoPath: opts.repo,
        maxIters: 5,
        kane: {
          assertionMode: "dom",
          finalValidation: true,
          bugDetection: "continue",
          validateEvidence: true,
          mergeEvidence: true,
        },
        flows:
          res.flows.length > 0
            ? res.flows
            : [
                {
                  id: "home-smoke",
                  name: "Home page heading",
                  objective:
                    "Open {{url}}, read the main heading text, and store it strictly under key 'heading'",
                  storeKeys: ["heading"],
                },
              ],
      };
      await writeFile(opts.output, stringify(cfg), "utf8");
      console.log(pc.green(`Discovered ${cfg.flows.length} flow(s) and wrote ${opts.output}`));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("baseline")
  .description("Run flows on legacy URL and cache golden baseline")
  .option("-c, --config <path>", "Config file", "theseus.yaml")
  .action(async (opts) => {
    try {
      await captureBaseline(opts.config, DEFAULT_BASE_DIR);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("verify")
  .description("Verify modern URL against cached legacy baseline (CI gate)")
  .option("-c, --config <path>", "Config file", "theseus.yaml")
  .option("--refresh-baseline", "Re-capture legacy baseline before verifying", false)
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      let baseline = opts.refreshBaseline ? null : await loadBaseline(DEFAULT_BASE_DIR);
      if (!baseline || baseline.legacyUrl !== config.legacyUrl) {
        await captureBaseline(opts.config, DEFAULT_BASE_DIR);
        baseline = await loadBaseline(DEFAULT_BASE_DIR);
      }
      if (!baseline) throw new SetupError("Baseline missing after capture");

      const diffs: FlowDiff[] = [];
      for (const flow of config.flows) {
        const legacy = baseline.results[flow.id];
        if (!legacy) throw new SetupError(`Flow "${flow.id}" missing from baseline; run with --refresh-baseline`);
        const modern = await runKaneFlow(flow, config.modernUrl, { kaneSettings: config.kane });
        if (modern.status === "setup_error") {
          throw new SetupError(`Kane CLI setup/auth error on flow "${flow.id}": ${modern.summary}`);
        }
        diffs.push(diffFlowResult(flow, legacy, modern));
      }

      printFlowSummary(diffs);
      const allEquivalent = diffs.every((d) => d.equivalent);
      console.log(allEquivalent ? pc.green("\nEQUIVALENT") : pc.red("\nDRIFT DETECTED"));
      process.exit(allEquivalent ? 0 : 1);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("converge")
  .description("Run closed-loop verification and agent patching until equivalent")
  .option("-c, --config <path>", "Config file", "theseus.yaml")
  .option("--max-iters <n>", "Max convergence iterations", (v) => Number.parseInt(v, 10))
  .option("--agent-cmd <cmd>", "Custom coding agent command")
  .option("--refresh-baseline", "Re-capture legacy baseline", false)
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const report = await runConvergeLoop(config, {
        baseDir: DEFAULT_BASE_DIR,
        refreshBaseline: opts.refreshBaseline,
        maxIters: opts.maxIters,
        agentCmd: opts.agentCmd,
        kaneExecutor: (flow, url) => runKaneFlow(flow, url, { kaneSettings: config.kane }),
        digestFn: computeEquivalenceDigest,
        onProgress: (msg) => console.log(pc.dim(msg)),
      });

      const paths = await writeReports(DEFAULT_BASE_DIR, report);
      printReportFooter(report, paths);
      process.exit(report.verdict === "EQUIVALENT" ? 0 : 1);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("demo")
  .description("Boot bundled legacy + modern apps (shop or real-world TodoMVC) and run convergence")
  .option("--suite <name>", "Benchmark suite: shop | todomvc", "shop")
  .option("--replay", "Instant <5s replay of real committed Kane CLI evidence (no account needed)", false)
  .option("--max-iters <n>", "Max convergence iterations", (v) => Number.parseInt(v, 10), 5)
  .option("--agent-cmd <cmd>", "Custom coding agent command")
  .option("--refresh-baseline", "Re-capture legacy baseline", true)
  .action(async (opts) => {
    const suite: DemoSuite = opts.suite === "todomvc" ? "todomvc" : "shop";

    if (opts.replay) {
      try {
        await runReplayDemo(suite);
      } catch (err) {
        handleError(err);
      }
      return;
    }

    let servers: Awaited<ReturnType<typeof startDemoServers>> | null = null;
    const cleanup = async () => {
      if (servers) {
        const s = servers;
        servers = null;
        await s.close();
      }
    };
    const onSignal = () => {
      void cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      const auth = await checkKaneAuth();
      if (!auth.authenticated) {
        console.log(
          pc.yellow(
            "Kane CLI is not authenticated on this machine — falling back to --replay of our real committed Kane run.\n(Run `kane-cli login` to run live browser convergence.)\n",
          ),
        );
        await runReplayDemo(suite);
        return;
      }

      servers = await startDemoServers(undefined, suite);
      console.log(
        pc.bold(`Demo servers live (${suite}): legacy=${servers.legacyUrl} modern=${servers.modernUrl}`),
      );
      const baseCfg = await loadConfig(servers.configPath);
      const config: TheseusConfig = {
        ...baseCfg,
        legacyUrl: servers.legacyUrl,
        modernUrl: servers.modernUrl,
        repoPath: servers.repoPath,
      };
      const report = await runConvergeLoop(config, {
        baseDir: DEFAULT_BASE_DIR,
        refreshBaseline: opts.refreshBaseline,
        maxIters: opts.maxIters,
        agentCmd: opts.agentCmd,
        kaneExecutor: (flow, url) => runKaneFlow(flow, url, { kaneSettings: config.kane }),
        digestFn: computeEquivalenceDigest,
        onProgress: (msg) => console.log(pc.dim(msg)),
      });
      const paths = await writeReports(DEFAULT_BASE_DIR, report);
      printReportFooter(report, paths);
      await cleanup();
      process.exit(report.verdict === "EQUIVALENT" ? 0 : 1);
    } catch (err) {
      await cleanup();
      handleError(err);
    }
  });

program.parseAsync(process.argv);
