import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

export type BuildChunk = {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};
export type BuildManifest = Record<string, BuildChunk>;

/** Count the complete static graph, not just the file named index.js. */
export function startupAssets(manifest: BuildManifest, entry = "index.html"): string[] {
  if (!manifest[entry]?.isEntry) throw new Error(`Missing application entry: ${entry}`);
  return dependencyAssets(manifest, entry);
}

/**
 * The terminal icon faces (`src/shared/ui/fonts`). A browser fetches one when
 * a terminal view first shows a glyph from its range, and the service worker
 * caches it then. No chunk needs one to run, so none belongs to a startup or
 * offline closure: a megabyte of icons is not what a first visit waits for.
 */
export const onDemandAsset = (file: string): boolean => /^assets\/symbols-nerd-font-[a-z]+-[A-Za-z0-9_-]+\.woff2$/.test(file);

/** A chunk is usable offline only with its complete static dependency closure. */
export function dependencyAssets(manifest: BuildManifest, entry: string): string[] {
  const visited = new Set<string>();
  const assets = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing static dependency: ${key}`);
    visited.add(key);
    assets.add(chunk.file);
    for (const css of chunk.css ?? []) assets.add(css);
    for (const asset of chunk.assets ?? []) if (!onDemandAsset(asset)) assets.add(asset);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };
  visit(entry);
  return [...assets].sort();
}

export const STARTUP_BUDGET = { javascriptGzip: 250_000, cssGzip: 25_000 };

export async function measureBuild(directory: string) {
  const manifest: BuildManifest = JSON.parse(await readFile(resolve(directory, ".vite/manifest.json"), "utf8"));
  const initial = new Set(startupAssets(manifest));
  const all = new Set(Object.values(manifest).flatMap(chunk => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]));
  const assets = await Promise.all([...all].sort().map(async file => {
    if (!file.startsWith("assets/") || file.includes("..")) throw new Error(`Unexpected build asset: ${file}`);
    const path = resolve(directory, file);
    const content = await readFile(path);
    return { file, initial: initial.has(file), bytes: (await stat(path)).size, gzip: gzipSync(content).length };
  }));
  const total = (extension: string) => assets.filter(asset => asset.initial && asset.file.endsWith(extension))
    .reduce((sum, asset) => sum + asset.gzip, 0);
  const javascriptGzip = total(".js");
  const cssGzip = total(".css");
  return {
    schema: 1, compression: "gzip", entry: "index.html", javascriptGzip, cssGzip,
    budget: STARTUP_BUDGET,
    passed: javascriptGzip <= STARTUP_BUDGET.javascriptGzip && cssGzip <= STARTUP_BUDGET.cssGzip,
    assets,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const report = await measureBuild(resolve(args.find(arg => !arg.startsWith("--")) ?? "dist"));
  const output = args.find(arg => arg.startsWith("--report="))?.slice("--report=".length);
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Startup gzip: JS ${report.javascriptGzip} / ${report.budget.javascriptGzip} bytes; CSS ${report.cssGzip} / ${report.budget.cssGzip} bytes`);
  console.log(`${report.assets.filter(asset => asset.initial).length} initial assets; ${report.assets.length} total assets`);
  if (!report.passed && !args.includes("--report-only")) process.exitCode = 1;
}
