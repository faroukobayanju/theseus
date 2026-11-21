import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { loadConfig, scaffoldConfig } from "./config.js";
import { loadBaseline, saveBaseline } from "./core/baseline.js";
import { runConvergeLoop } from "./core/converge.js";
import { diffFlowResult } from "./core/diff.js";
import { startDemoServers } from "./demo.js";
import { runKaneFlow } from "./kane/runner.js";
import { writeReports } from "./report/html.js";
import { computeEquivalenceDigest } from "./report/signer.js";
import { SetupError, type FlowDiff, type KaneRunResult } from "./types.js";

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

async function captureBaseline(configPath: string, baseDir: string): Promise<void> {
  const config = await loadConfig(configPath);
  console.log(pc.bold(`Capturing legacy baseline from ${config.legacyUrl}...`));
  const results: KaneRunResult[] = [];
  for (const flow of config.flows) {
    console.log(`  • ${flow.name}`);
    const res = await runKaneFlow(flow, config.legacyUrl);
    if (res.status === "setup_error") {
      throw new SetupError(`Kane CLI setup/auth error on flow "${flow.id}": ${res.summary}`);
    }
    results.push(res);
  }
  const saved = await saveBaseline(baseDir, config.legacyUrl, results);
  console.log(pc.green(`Baseline cached at ${saved}`));
}

const program = new Command();
program
  .name("theseus")
  .description("Rewrite a legacy web app and prove behavioral equivalence with Kane CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold a theseus.yaml config")
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
        const modern = await runKaneFlow(flow, config.modernUrl);
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
        kaneExecutor: (flow, url) => runKaneFlow(flow, url),
        digestFn: computeEquivalenceDigest,
        onProgress: (msg) => console.log(pc.dim(msg)),
      });

      const { jsonPath, htmlPath } = await writeReports(DEFAULT_BASE_DIR, report);
      printFlowSummary(report.flows);
      console.log(`\nVerdict: ${report.verdict === "EQUIVALENT" ? pc.green(report.verdict) : pc.red(report.verdict)}`);
      console.log(`Digest:  ${pc.cyan(report.digest)}`);
      console.log(`Report:  ${htmlPath}`);
      console.log(`JSON:    ${jsonPath}`);
      process.exit(report.verdict === "EQUIVALENT" ? 0 : 1);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("demo")
  .description("Boot bundled legacy + modern shops and run live convergence")
  .option("--max-iters <n>", "Max convergence iterations", (v) => Number.parseInt(v, 10), 5)
  .option("--agent-cmd <cmd>", "Custom coding agent command")
  .option("--refresh-baseline", "Re-capture legacy baseline", true)
  .action(async (opts) => {
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
      servers = await startDemoServers();
      console.log(pc.bold(`Demo servers live: legacy=${servers.legacyUrl} modern=${servers.modernUrl}`));
      const baseCfg = await loadConfig(resolve("examples/theseus.demo.yaml"));
      const config = {
        ...baseCfg,
        legacyUrl: servers.legacyUrl,
        modernUrl: servers.modernUrl,
      };
      const report = await runConvergeLoop(config, {
        baseDir: DEFAULT_BASE_DIR,
        refreshBaseline: opts.refreshBaseline,
        maxIters: opts.maxIters,
        agentCmd: opts.agentCmd,
        kaneExecutor: (flow, url) => runKaneFlow(flow, url),
        digestFn: computeEquivalenceDigest,
        onProgress: (msg) => console.log(pc.dim(msg)),
      });
      const { jsonPath, htmlPath } = await writeReports(DEFAULT_BASE_DIR, report);
      printFlowSummary(report.flows);
      console.log(`\nVerdict: ${report.verdict === "EQUIVALENT" ? pc.green(report.verdict) : pc.red(report.verdict)}`);
      console.log(`Digest:  ${pc.cyan(report.digest)}`);
      console.log(`Report:  ${htmlPath}`);
      console.log(`JSON:    ${jsonPath}`);
      await cleanup();
      process.exit(report.verdict === "EQUIVALENT" ? 0 : 1);
    } catch (err) {
      await cleanup();
      handleError(err);
    }
  });

program.parseAsync(process.argv);
