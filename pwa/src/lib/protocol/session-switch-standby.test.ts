import { expect, test } from "bun:test";

// The direct negotiation and the page-visibility stand-ins are process-global; keep them out of the shared suite.
test("a relay handshake runs beside a direct candidate whose relay dropped under the commit", async () => {
  const target = new URL("../../../test-support/session-switch-standby-isolated.test.ts", import.meta.url);
  const process = Bun.spawn(["bun", "test", target.pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stderr).toContain("6 pass");
}, 30_000);
