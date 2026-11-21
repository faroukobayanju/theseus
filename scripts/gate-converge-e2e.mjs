import { execFileSync } from "node:child_process";

execFileSync("./node_modules/.bin/vitest", ["run", "tests/e2e/converge-e2e.test.ts"], {
  stdio: "inherit",
});

console.log("GATE_G3_PASS");
