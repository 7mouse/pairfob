import { expect, test } from "bun:test";

// The page-visibility stand-in is process-global; keep it out of the shared suite.
test("a standby handshake races the foreground probe through real encrypted transports", async () => {
  const target = new URL("../../../test-support/session-standby-isolated.test.ts", import.meta.url);
  const process = Bun.spawn(["bun", "test", target.pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stderr).toContain("8 pass");
}, 30_000);
