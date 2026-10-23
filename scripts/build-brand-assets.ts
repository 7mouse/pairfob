#!/usr/bin/env bun
// Builds every shipped brand surface from one mark definition: PWA icons,
// favicons, Apple touch icon, share cards, and the Android launcher, splash
// and foreground bitmaps. Rerun after editing the mark.
//
// Raster output uses Chrome. Set CHROME to override browser discovery.

import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BG = "#0a0c10";
const PX = 512 / 108;

const MARK = `
  <defs>
    <radialGradient id="wm" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#cbd6e6"/>
    </radialGradient>
    <radialGradient id="bm" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#a9c8ff"/>
      <stop offset="1" stop-color="#5b8fea"/>
    </radialGradient>
  </defs>
  <line x1="46" y1="48" x2="66" y2="62" stroke="url(#wm)" stroke-width="26" stroke-linecap="round"/>
  <circle cx="46" cy="48" r="21" fill="url(#wm)"/>
  <circle cx="66" cy="62" r="15" fill="url(#bm)"/>
  <circle cx="61" cy="57" r="3" fill="#ffffff" fill-opacity=".55"/>`;

const mark = (scale = 1, dx = 0, dy = 0) =>
  `<g transform="translate(${dx} ${dy}) scale(${scale})">${MARK}</g>`;

const svgDoc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const tile = (w: number, radius: number, scale: number, dx = 0, dy = 0) =>
  svgDoc(w, w, `<rect width="${w}" height="${w}" rx="${radius}" fill="${BG}"/>${mark(scale, dx, dy)}`);

const page = (w: number, h: number, body: string) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const arch of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-linux64"]) {
        const path = join(cache, build, arch, "chrome-headless-shell");
        if (existsSync(path)) return path;
      }
    }
  }
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const path of fixed) if (existsSync(path)) return path;
  throw new Error("no Chrome found; set CHROME=/path/to/chrome");
}

const CHROME = findChrome();
let counter = 0;

async function shoot(html: string, width: number, height: number, out: string): Promise<void> {
  const tmp = join(tmpdir(), `pairfob-brand-${process.pid}-${counter++}.html`);
  await writeFile(tmp, html);
  const result = spawnSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    "--virtual-time-budget=3000",
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    `file://${tmp}`,
  ], { encoding: "utf8" });
  await rm(tmp, { force: true });
  if (result.status !== 0) {
    throw new Error(`chrome failed for ${out}\n${result.stderr}`);
  }
  const bytes = Buffer.from(await Bun.file(out).arrayBuffer());
  if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error(`${out}: not a PNG`);
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  if (w !== width || h !== height) throw new Error(`${out}: ${w}x${h}, expected ${width}x${height}`);
  console.log(`${out.replace(ROOT + "/", "")} ${w}x${h}`);
}

async function write(path: string, text: string): Promise<void> {
  const target = join(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
  console.log(`${path} (svg)`);
}

const ANDROID_RES = "mobile/android/app/src/main/res";
const DENSITIES: Array<[string, number]> = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

async function main(): Promise<void> {
  const webIcon = tile(512, 112, PX);
  const maskableScale = PX * 1.35;
  const maskableOffset = (512 - 108 * maskableScale) / 2;

  await write("pwa/public/icon.svg", webIcon);
  await write("site/icon.svg", webIcon);
  await write("site/doc/public/icon.svg", webIcon);
  await write("pwa/public/mask-icon.svg", svgDoc(512, 512, `
  <g stroke="#000" fill="#000">
    <line x1="218.074" y1="227.556" x2="312.889" y2="293.926" stroke-width="123.259" stroke-linecap="round"/>
    <circle cx="218.074" cy="227.556" r="99.556"/>
    <circle cx="312.889" cy="293.926" r="71.111"/>
  </g>`));
  await write("site/mask-icon.svg", svgDoc(512, 512, `
  <g stroke="#000" fill="#000">
    <line x1="218.074" y1="227.556" x2="312.889" y2="293.926" stroke-width="123.259" stroke-linecap="round"/>
    <circle cx="218.074" cy="227.556" r="99.556"/>
    <circle cx="312.889" cy="293.926" r="71.111"/>
  </g>`));

  const web: Array<[string, number, string]> = [
    ["pwa/public/icon-192.png", 192, `<rect width="512" height="512" rx="112" fill="${BG}"/>${mark(PX)}`],
    ["pwa/public/icon-512.png", 512, `<rect width="512" height="512" rx="112" fill="${BG}"/>${mark(PX)}`],
    ["pwa/public/icon-maskable-512.png", 512, `<rect width="512" height="512" fill="${BG}"/>${mark(maskableScale, maskableOffset, maskableOffset)}`],
    ["pwa/public/apple-touch-icon.png", 180, `<rect width="512" height="512" fill="${BG}"/>${mark(PX)}`],
  ];
  for (const [path, size, body] of web) {
    await shoot(page(512, 512, body), size, size, join(ROOT, path));
  }
  await Bun.write(join(ROOT, "site/apple-touch-icon.png"), Bun.file(join(ROOT, "pwa/public/apple-touch-icon.png")));

  const foreground = page(108, 108, mark(1));
  const legacyRounded = page(108, 108, `<rect width="108" height="108" rx="24" fill="${BG}"/>${mark(1)}`);
  const legacyCircle = page(108, 108, `<rect width="108" height="108" rx="54" fill="${BG}"/>${mark(1)}`);
  for (const [density, factor] of DENSITIES) {
    const dir = join(ROOT, ANDROID_RES, `mipmap-${density}`);
    await shoot(foreground, 108 * factor, 108 * factor, join(dir, "ic_launcher_foreground.png"));
    const legacy = factor === 1 ? 48 : factor === 1.5 ? 72 : factor === 2 ? 96 : factor === 3 ? 144 : 192;
    await shoot(legacyRounded, legacy, legacy, join(dir, "ic_launcher.png"));
    await shoot(legacyCircle, legacy, legacy, join(dir, "ic_launcher_round.png"));
  }

  const splashes: Array<[string, number, number, number]> = [
    ["drawable/splash.png", 480, 320, 1],
    ["drawable-port-mdpi/splash.png", 320, 480, 1],
    ["drawable-port-hdpi/splash.png", 480, 800, 1.5],
    ["drawable-port-xhdpi/splash.png", 720, 1280, 2],
    ["drawable-port-xxhdpi/splash.png", 960, 1600, 3],
    ["drawable-port-xxxhdpi/splash.png", 1280, 1920, 4],
    ["drawable-land-mdpi/splash.png", 480, 320, 1],
    ["drawable-land-hdpi/splash.png", 800, 480, 1.5],
    ["drawable-land-xhdpi/splash.png", 1280, 720, 2],
    ["drawable-land-xxhdpi/splash.png", 1600, 960, 3],
    ["drawable-land-xxxhdpi/splash.png", 1920, 1280, 4],
  ];
  for (const [path, w, h, factor] of splashes) {
    const size = 60 * factor;
    const scale = size / 108;
    const body = `<rect width="${w}" height="${h}" fill="${BG}"/>${mark(scale, (w - size) / 2, (h - size) / 2)}`;
    await shoot(page(w, h, body), w, h, join(ROOT, ANDROID_RES, path));
  }

  await renderOg();
}

async function renderOg(): Promise<void> {
  for (const [src, out] of [["og.html", "og.png"], ["og-en.html", "og-en.png"]] as const) {
    const html = join(ROOT, "site", src);
    const target = join(ROOT, "site", out);
    const result = spawnSync(CHROME, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=5000",
      "--window-size=1200,630",
      `--screenshot=${target}`,
      `file://${html}`,
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`chrome failed for ${out}\n${result.stderr}`);
    const bytes = Buffer.from(await Bun.file(target).arrayBuffer());
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    if (w !== 1200 || h !== 630) throw new Error(`${out}: ${w}x${h}`);
    console.log(`site/${out} ${w}x${h}`);
  }
}

await main();
