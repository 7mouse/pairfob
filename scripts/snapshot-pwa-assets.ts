import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const filename = "[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\\.(?:js|css|json|wasm|png|svg|webp|woff2?)";
const safeFile = new RegExp(`^${filename}$`);

/** Freeze the hosted build before packing a replacement, including legacy dynamic imports. */
export async function snapshotPwaAssets(origin: string, destination: string): Promise<void> {
  const base = new URL(origin);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1") throw new Error("HTTPS origin required");
  if (base.pathname !== "/" || base.search || base.hash) throw new Error("Expected an origin, not a page URL");
  const read = async (path: string) => {
    const response = await fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`Hosted asset ${path}: HTTP ${response.status}`);
    return response;
  };
  const html = await (await read("/pair")).text();
  const pending = new Set<string>();
  const scanned = new Set<string>();
  const add = (file: string) => {
    if (!safeFile.test(file)) throw new Error(`Invalid hosted asset name: ${file}`);
    if (!scanned.has(file)) pending.add(file);
  };
  const discover = (text: string) => {
    // The pre-manifest build emits Vite imports, dependency maps and new URL()
    // references as quoted asset filenames. Follow those transitively once.
    const pattern = new RegExp(`["'](?:/assets/|assets/|\\./)?(${filename})["']`, "g");
    for (const match of text.matchAll(pattern)) add(match[1]);
    const css = new RegExp(`url\\(["']?(?:/assets/|\\./)?(${filename})["']?\\)`, "g");
    for (const match of text.matchAll(css)) add(match[1]);
  };
  discover(html);
  if (!pending.size) throw new Error("Hosted page has no hashed application assets");
  await mkdir(resolve(destination, "assets"), { recursive: true });
  let history: unknown;
  const response = await fetch(new URL("/assets/releases.json", base), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (response.ok && response.headers.get("content-type")?.includes("json")) {
    history = await response.json();
    const value = history as { schema?: number; generations?: { id: string; files: string[] }[] };
    if (value.schema !== 1 || !Array.isArray(value.generations) || value.generations.length > 3) throw new Error("Invalid hosted asset history");
    for (const generation of value.generations) {
      if (!Array.isArray(generation.files)) throw new Error("Invalid hosted generation");
      for (const file of generation.files) add(file);
    }
  }
  const evidence: Record<string, { bytes: number; sha256: string }> = {};
  let size = 0;
  while (pending.size) {
    if (scanned.size + pending.size > 512) throw new Error("Hosted asset graph exceeds the safety bound");
    const wave = [...pending].filter(file => !scanned.has(file)).slice(0, 6);
    if (!wave.length) break;
    for (const file of wave) { pending.delete(file); scanned.add(file); }
    await Promise.all(wave.map(async file => {
      const res = await read(`/assets/${file}`);
      if (res.headers.get("content-type")?.includes("text/html")) throw new Error(`HTML fallback for asset: ${file}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      size += bytes.length;
      if (size > 32 * 1024 * 1024) throw new Error("Hosted asset graph exceeds 32 MiB");
      await writeFile(resolve(destination, "assets", file), bytes);
      evidence[file] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      if (/\.(js|css|json)$/.test(file)) discover(bytes.toString("utf8"));
    }));
  }
  if (await (await read("/pair")).text() !== html) throw new Error("Hosted build changed during snapshot; capture it again");
  if (history) await writeFile(resolve(destination, "assets/releases.json"), JSON.stringify(history));
  await writeFile(resolve(destination, "index.html"), html);
  await writeFile(resolve(destination, "snapshot.json"), JSON.stringify({ origin: base.origin, at: new Date().toISOString(), files: evidence }, null, 2));
  console.log(`Frozen ${scanned.size} hosted assets (${size} bytes) from ${base.origin}`);
}

if (import.meta.main) {
  const [origin, destination] = process.argv.slice(2);
  if (!origin || !destination) throw new Error("Usage: snapshot-pwa-assets.ts https://pairfob.com output-directory");
  await snapshotPwaAssets(origin, resolve(destination));
}
