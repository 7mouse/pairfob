import { expect, test } from "bun:test";

// Pairing tests mock the client re-export; isolate real session transport tests.
test("the dial answers the first reads through real encrypted transports", async () => {
  const target = new URL("../../../test-support/session-first-reads-isolated.test.ts", import.meta.url);
  const process = Bun.spawn(["bun", "test", target.pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stderr).toContain("11 pass");
}, 30_000);
