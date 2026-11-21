import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => res(addr.port));
    });
    s.on("error", rej);
  });
}

async function waitHealth(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not become healthy: ${url}`);
}

const p1 = await freePort();
const p2 = await freePort();
const legacy = spawn(process.execPath, [resolve("examples/legacy-shop/server.mjs")], {
  env: { ...process.env, PORT: String(p1) },
  stdio: "ignore",
});
const modern = spawn(process.execPath, [resolve("examples/modern-shop/server.mjs")], {
  env: { ...process.env, PORT: String(p2) },
  stdio: "ignore",
});

try {
  await Promise.all([
    waitHealth(`http://127.0.0.1:${p1}`),
    waitHealth(`http://127.0.0.1:${p2}`),
  ]);

  const legacyHtml = await (await fetch(`http://127.0.0.1:${p1}/`)).text();
  const modernHtml = await (await fetch(`http://127.0.0.1:${p2}/`)).text();
  assert.ok(legacyHtml.includes("Widget Pro"), "legacy HTML missing Widget Pro");
  assert.ok(modernHtml.includes("Widget Pro"), "modern HTML missing Widget Pro");

  const pricing = await import(pathToFileURL(resolve("examples/modern-shop/pricing.mjs")).href);
  const t = pricing.calculateTotals(100, "SAVE10");
  assert.notEqual(Number(t.total).toFixed(2), "97.43", "Expected Drift 1 (tax/discount order) in modern pricing");

  const promo = pricing.applyPromo("SAVE10", "SAVE20");
  assert.notEqual(promo.error, "Promo codes cannot be combined", "Expected Drift 2 (promo stacking) in modern pricing");

  const checkout = pricing.validateCheckout(5);
  assert.notEqual(checkout.error, "Minimum order is $10.00", "Expected Drift 3 (min order) in modern pricing");

  console.log("GATE_G2_PASS");
} finally {
  legacy.kill("SIGTERM");
  modern.kill("SIGTERM");
}
