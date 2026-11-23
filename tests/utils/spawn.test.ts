import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWindowsCmdShim } from "../../src/utils/spawn.js";

describe("parseWindowsCmdShim", () => {
  it("extracts the underlying .cjs entrypoint from a Windows npm .cmd shim (kane-cli)", () => {
    const npmShim = [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      '"%_prog%"  "%dp0%\\node_modules\\@testmuai\\kane-cli\\bin\\kane-cli.cjs" %*',
    ].join("\r\n");

    const cmdDir = "/fake/appdata/npm";
    const expected = resolve(cmdDir, "node_modules/@testmuai/kane-cli/bin/kane-cli.cjs");

    const target = parseWindowsCmdShim(npmShim, cmdDir, (p) => p === expected);
    expect(target).toEqual({ kind: "node", targetPath: expected });
  });

  it("extracts an underlying .exe binary wrapped inside a Windows .cmd shim (claude)", () => {
    const claudeShim = [
      "@ECHO off",
      'SET dp0=%~dp0',
      '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*',
    ].join("\r\n");

    const cmdDir = "/fake/appdata/npm";
    const expected = resolve(cmdDir, "node_modules/@anthropic-ai/claude-code/bin/claude.exe");

    const target = parseWindowsCmdShim(claudeShim, cmdDir, (p) => p === expected);
    expect(target).toEqual({ kind: "exe", targetPath: expected });
  });

  it("returns null when the referenced script does not exist", () => {
    const shim = '"%_prog%" "%dp0%\\node_modules\\foo\\bin\\cli.js" %*';
    expect(parseWindowsCmdShim(shim, "/fake", () => false)).toBeNull();
  });
});
