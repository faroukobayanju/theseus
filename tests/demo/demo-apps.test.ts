import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { startDemoServers, type RunningDemoServers } from "../../src/demo.js";

const ROOT = resolve(process.cwd());

describe("demo apps and startDemoServers", () => {
  let running: RunningDemoServers | null = null;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = null;
    }
  });

  it("boots legacy and modern servers on free ports, serves / and /health, and closes cleanly", async () => {
    running = await startDemoServers(ROOT);

    expect(running.legacyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(running.modernUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(running.legacyUrl).not.toBe(running.modernUrl);

    const [legacyHealth, modernHealth, legacyRoot, modernRoot, pricingRes] =
      await Promise.all([
        fetch(`${running.legacyUrl}/health`),
        fetch(`${running.modernUrl}/health`),
        fetch(`${running.legacyUrl}/`),
        fetch(`${running.modernUrl}/`),
        fetch(`${running.modernUrl}/pricing.mjs`),
      ]);

    expect(legacyHealth.status).toBe(200);
    expect(modernHealth.status).toBe(200);
    expect(legacyRoot.status).toBe(200);
    expect(modernRoot.status).toBe(200);
    expect(pricingRes.status).toBe(200);

    const legacyHtml = await legacyRoot.text();
    const modernHtml = await modernRoot.text();
    expect(legacyHtml).toContain("LegacyMart 2012");
    expect(legacyHtml).toContain('id="final-total"');
    expect(legacyHtml).toContain('id="promo-error"');
    expect(legacyHtml).toContain('id="checkout-error"');

    expect(modernHtml).toContain("ModernMart");
    expect(modernHtml).toContain("/pricing.mjs");
    expect(modernHtml).toContain('id="final-total"');
    expect(modernHtml).toContain('id="promo-error"');
    expect(modernHtml).toContain('id="checkout-error"');

    const { legacyUrl, modernUrl } = running;
    await running.close();
    running = null;

    await expect(fetch(`${legacyUrl}/health`)).rejects.toThrow();
    await expect(fetch(`${modernUrl}/health`)).rejects.toThrow();
  });

  it("plants the 3 exact behavioral drifts in examples/modern-shop/pricing.mjs", async () => {
    const pricingUrl = pathToFileURL(
      resolve(ROOT, "examples/modern-shop/pricing.mjs"),
    ).href;
    const pricing = (await import(pricingUrl)) as {
      calculateTotals: (
        subtotal: number,
        promoCode?: string,
      ) => { total: number; formattedTotal: string };
      applyPromo: (
        currentPromo: string,
        nextPromo: string,
      ) => { promo: string; error: string };
      validateCheckout: (subtotal: number) => { ok: boolean; error: string };
    };

    // Drift 1: tax applied before discount -> $98.25 instead of legacy $97.43
    const totals = pricing.calculateTotals(100, "SAVE10");
    expect(totals.total).toBe(98.25);
    expect(totals.formattedTotal).toBe("$98.25");

    // Drift 2: silently replaces active promo instead of "Promo codes cannot be combined"
    const promo = pricing.applyPromo("SAVE10", "SAVE20");
    expect(promo).toEqual({ promo: "SAVE20", error: "" });

    // Drift 3: allows checkout under $10.00 instead of "Minimum order is $10.00"
    const checkout = pricing.validateCheckout(3);
    expect(checkout).toEqual({ ok: true, error: "" });
  });

  it("ships a valid examples/theseus.demo.yaml config with 3 flows", async () => {
    const cfg = await loadConfig(resolve(ROOT, "examples/theseus.demo.yaml"));
    expect(cfg.legacyUrl).toBe("http://127.0.0.1:4101");
    expect(cfg.modernUrl).toBe("http://127.0.0.1:4102");
    expect(cfg.repoPath).toBe("examples/modern-shop");
    expect(cfg.maxIters).toBe(5);
    expect(cfg.flows.map((f) => f.id)).toEqual([
      "discount-tax-rounding",
      "promo-stacking-guard",
      "minimum-order-guard",
    ]);
    expect(cfg.flows.map((f) => f.storeKeys)).toEqual([
      ["final_total"],
      ["promo_error"],
      ["checkout_error"],
    ]);
  });
});
