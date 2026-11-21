import { execFileSync } from "node:child_process";

const cmds = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
  ["node", ["dist/cli.js", "--help"]],
];

for (const [bin, args] of cmds) {
  execFileSync(bin, args, { stdio: "inherit" });
}

console.log("GATE_G1_PASS");
