import { expect, test } from "bun:test";

// The module stand-ins are process-global; keep them out of the shared suite.
test("a direct switch carries relay requests still out instead of waiting for them", async () => {
  const target = new URL("../../../test-support/session-commit-carry-isolated.test.ts", import.meta.url);
  const process = Bun.spawn(["bun", "test", target.pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stderr).toContain("4 pass");
}, 30_000);
