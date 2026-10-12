import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("pairing loader cancellation and validation use the real transport boundary", () => {
  // Pairing controller suites mock the client barrel, including its live ESM
  // re-exports. Exercise the real loader in a process without those mocks.
  const result = spawnSync(process.execPath, ["test", "test-support/pair-loader-isolated.test.ts"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)), encoding: "utf8", timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
}, 35_000);
