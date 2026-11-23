import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { startDemoServers, type RunningDemoServers } from "../../src/demo.js";

const ROOT = resolve(process.cwd());

describe("real-world TodoMVC benchmark suite", () => {
  let running: RunningDemoServers | null = null;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = null;
    }
  });

  it("boots legacy and modern TodoMVC servers on free ports and serves endpoints", async () => {
    running = await startDemoServers(ROOT, "todomvc");

    const [legacyHealth, modernHealth, legacyRoot, modernRoot, storeRes] = await Promise.all([
      fetch(`${running.legacyUrl}/health`),
      fetch(`${running.modernUrl}/health`),
      fetch(`${running.legacyUrl}/`),
      fetch(`${running.modernUrl}/`),
      fetch(`${running.modernUrl}/store.mjs`),
    ]);

    expect(legacyHealth.status).toBe(200);
    expect(modernHealth.status).toBe(200);
    expect(legacyRoot.status).toBe(200);
    expect(modernRoot.status).toBe(200);
    expect(storeRes.status).toBe(200);
  });

  it("exhibits the 3 real-world TodoMVC rewrite drifts before convergence", async () => {
    const storeUrl = pathToFileURL(resolve(ROOT, "benchmarks/todomvc/modern/store.mjs")).href;
    const mod = (await import(storeUrl)) as {
      createTodoStore: () => {
        addTodo: (raw: string) => boolean;
        toggleTodo: (id: number) => void;
        clearCompleted: () => void;
        formatItemsLeft: () => string;
        getAll: () => Array<{ id: number; title: string; completed: boolean }>;
      };
    };

    const store = mod.createTodoStore();
    store.addTodo("Buy milk");
    // Drift 3: pluralization bug ("1 items left" instead of "1 item left")
    expect(store.formatItemsLeft()).toBe("1 items left");

    // Drift 1: whitespace-only entry erroneously added
    expect(store.addTodo("   ")).toBe(true);
    expect(store.getAll()).toHaveLength(2);

    // Drift 2: clearCompleted wipes active todos too
    store.toggleTodo(1);
    store.clearCompleted();
    expect(store.getAll()).toHaveLength(0);
  });

  it("loads benchmarks/todomvc/theseus.yaml with full Kane CLI settings enabled", async () => {
    const cfg = await loadConfig(resolve(ROOT, "benchmarks/todomvc/theseus.yaml"));
    expect(cfg.kane?.finalValidation).toBe(true);
    expect(cfg.kane?.bugDetection).toBe("continue");
    expect(cfg.kane?.validateEvidence).toBe(true);
    expect(cfg.kane?.mergeEvidence).toBe(true);
    expect(cfg.flows.map((f) => f.id)).toEqual([
      "todomvc-singular-counter",
      "todomvc-whitespace-guard",
      "todomvc-clear-completed",
    ]);
  });
});
