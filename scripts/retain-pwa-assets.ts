import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Generation = { id: string; files: string[] };
const hashed = /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|json|wasm|png|svg|webp|woff2?)$/;
const retainedGenerations = 2;

function validate(value: unknown): Generation[] {
  if (!value || typeof value !== "object" || !("generations" in value) || !Array.isArray(value.generations)) {
    throw new Error("Invalid previous PWA asset history");
  }
  return value.generations.map((item: Generation) => {
    if (!item || !/^[a-f0-9]{16,64}$/.test(item.id) || !Array.isArray(item.files)
      || item.files.length > 512 || !item.files.every(file => typeof file === "string" && hashed.test(file))) {
      throw new Error("Invalid previous PWA generation");
    }
    return { id: item.id, files: [...new Set(item.files)].sort() };
  });
}

async function existingHistory(directory: string): Promise<Generation[]> {
  try { return validate(JSON.parse(await readFile(resolve(directory, "assets/releases.json"), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let files: string[];
  try { files = (await readdir(resolve(directory, "assets"))).filter(file => hashed.test(file)).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!files.length) return [];
  // Migration from the monolithic build, before it carried release metadata.
  return [{ id: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files }];
}

async function readAsset(directory: string, file: string): Promise<Buffer> {
  const path = resolve(directory, "assets", file);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular asset: ${file}`);
  return readFile(path);
}

/** Stage two previous immutable graphs; callers replace the packed site afterwards. */
export async function retainPwaAssets(previous: string, current: string, staging: string): Promise<Generation[]> {
  const html = await readFile(resolve(current, "index.html"), "utf8");
  const match = html.match(/content="\/assets\/(pwa-assets-([a-f0-9]{16})\.json)"/);
  if (!match) throw new Error("Current build has no hashed asset graph");
  const graph = JSON.parse(await readFile(resolve(current, "assets", match[1]), "utf8"));
  if (!Array.isArray(graph.assets)) throw new Error("Current build has no complete asset inventory");
  const generation = validate({ generations: [{ id: match[2], files: [match[1], ...graph.assets.map((file: string) => {
    if (!file.startsWith("/assets/")) throw new Error("Asset outside generated directory");
    return file.slice("/assets/".length);
  })] }] })[0];
  const prior = (await existingHistory(previous)).filter(item => item.id !== generation.id).slice(0, retainedGenerations);
  const currentFiles = new Set(generation.files);
  await mkdir(resolve(staging, "assets"), { recursive: true });
  for (const file of new Set(prior.flatMap(item => item.files))) {
    const bytes = await readAsset(previous, file);
    if (currentFiles.has(file)) {
      if (!bytes.equals(await readAsset(current, file))) throw new Error(`Immutable asset collision: ${file}`);
    } else await writeFile(resolve(staging, "assets", file), bytes);
  }
  const generations = [generation, ...prior];
  await writeFile(resolve(staging, "assets/releases.json"), JSON.stringify({ schema: 1, generations }));
  return generations;
}

if (import.meta.main) {
  const [previous, current, staging] = process.argv.slice(2);
  if (!previous || !current || !staging) throw new Error("Usage: retain-pwa-assets.ts previous-build current-build staging-directory");
  const result = await retainPwaAssets(resolve(previous), resolve(current), resolve(staging));
  console.log(`pack: retaining ${result.length - 1} previous PWA asset generations`);
}
