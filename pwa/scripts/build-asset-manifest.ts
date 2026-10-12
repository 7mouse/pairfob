import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { dependencyAssets, startupAssets, type BuildManifest } from "./performance-budget";

export function assetGraph(manifest: BuildManifest) {
  const path = (file: string) => {
    if (!/^assets\/[A-Za-z0-9_.-]+$/.test(file)) throw new Error(`Invalid build asset: ${file}`);
    return `/${file}`;
  };
  const chunks = Object.fromEntries(Object.keys(manifest).sort().map(key => [
    path(manifest[key].file), dependencyAssets(manifest, key).map(path),
  ]));
  return { schema: 1, startup: startupAssets(manifest).map(path), chunks };
}

export async function writeAssetManifest(directory: string): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(directory, ".vite/manifest.json"), "utf8"));
  const graph = assetGraph(manifest);
  const assets = (await readdir(resolve(directory, "assets"))).filter(name => !name.startsWith("pwa-assets-"))
    .map(name => `/assets/${name}`).sort();
  const content = JSON.stringify({ ...graph, assets });
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const url = `/assets/pwa-assets-${hash}.json`;
  await writeFile(resolve(directory, url.slice(1)), content);
  const index = resolve(directory, "index.html");
  const html = (await readFile(index, "utf8")).replace(/\s*<meta name="pairfob-assets" content="[^"]+"\s*\/>/g, "");
  if (!html.includes("</head>")) throw new Error("Missing application HTML head");
  await writeFile(index, html.replace("</head>", `  <meta name="pairfob-assets" content="${url}" />\n  </head>`));
  return url;
}

if (import.meta.main) console.log(`Asset graph: ${await writeAssetManifest(resolve(process.argv[2] ?? "dist"))}`);
