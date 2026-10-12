import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retainPwaAssets } from "./retain-pwa-assets";

async function build(root: string, id: string, files: Record<string, string>) {
  await mkdir(join(root, "assets"), { recursive: true });
  for (const [file, value] of Object.entries(files)) await writeFile(join(root, "assets", file), value);
  const name = `pwa-assets-${id}.json`;
  await writeFile(join(root, "assets", name), JSON.stringify({ assets: Object.keys(files).map(file => `/assets/${file}`) }));
  await writeFile(join(root, "index.html"), `<meta name="pairfob-assets" content="/assets/${name}" />`);
}

test("a new pack retains old lazy chunks, repeat packing does not add duplicate generations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pairfob-asset-retention-"));
  try {
    const previous = join(root, "previous"), current = join(root, "current"), staged = join(root, "staged");
    await mkdir(join(previous, "assets"), { recursive: true });
    await writeFile(join(previous, "assets/terminal-12345678.js"), "old terminal");
    await build(current, "a".repeat(16), { "app-abcdefgh.js": "new app" });
    expect(await retainPwaAssets(previous, current, staged)).toHaveLength(2);
    expect(await readFile(join(staged, "assets/terminal-12345678.js"), "utf8")).toBe("old terminal");
    await cp(current, previous, { recursive: true });
    await cp(staged, previous, { recursive: true });
    expect(await retainPwaAssets(previous, current, join(root, "repeat"))).toHaveLength(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("retention is bounded to two earlier builds and refuses an immutable filename collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "pairfob-asset-retention-"));
  try {
    const previous = join(root, "previous"), current = join(root, "current"), staged = join(root, "staged");
    await mkdir(join(previous, "assets"), { recursive: true });
    const generations = ["1", "2", "3"].map(n => ({ id: n.repeat(16), files: [`app-${n.repeat(8)}.js`] }));
    await writeFile(join(previous, "assets/releases.json"), JSON.stringify({ schema: 1, generations }));
    for (const generation of generations) await writeFile(join(previous, "assets", generation.files[0]), generation.id);
    await build(current, "a".repeat(16), { "app-abcdefgh.js": "new" });
    expect((await retainPwaAssets(previous, current, staged)).map(item => item.id)).toEqual(["a".repeat(16), "1".repeat(16), "2".repeat(16)]);
    await build(current, "b".repeat(16), { "app-11111111.js": "different bytes under the same hash" });
    await expect(retainPwaAssets(previous, current, staged)).rejects.toThrow("Immutable asset collision");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a missing old dependency aborts packing instead of publishing a broken retained version", async () => {
  const root = await mkdtemp(join(tmpdir(), "pairfob-asset-retention-"));
  try {
    const previous = join(root, "previous"), current = join(root, "current");
    await mkdir(join(previous, "assets"), { recursive: true });
    await writeFile(join(previous, "assets/releases.json"), JSON.stringify({ generations: [{ id: "1".repeat(16), files: ["gone-12345678.js"] }] }));
    await build(current, "a".repeat(16), { "app-abcdefgh.js": "new" });
    await expect(retainPwaAssets(previous, current, join(root, "staged"))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
