import { expect, test } from "bun:test";
import { ICON_FAMILY } from "../../../shared/ui/fonts/term-glyphs";
import { ICON_FONT_RETRY_MS, iconFontWatcher } from "./full-terminal-icon-font";

const utf8 = (text: string) => new TextEncoder().encode(text);
const settle = () => new Promise((done) => setTimeout(done, 0));

type Load = { font: string; text: string; resolve(faces: unknown[]): void; reject(error: Error): void };

function fonts() {
  const loads: Load[] = [];
  return {
    loads,
    load: (font: string, text?: string) => new Promise<FontFace[]>((resolve, reject) => {
      loads.push({ font, text: text ?? "", resolve: resolve as Load["resolve"], reject });
    }),
  };
}

test("a screen without icons loads nothing and draws nothing again", async () => {
  const set = fonts();
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, set);
  note(utf8("\x1b[2J\x1b[H$ ls\r\nsrc  main.ts  ⏺ 中文"));
  await settle();
  expect(set.loads).toEqual([]);
  expect(redraws).toBe(0);
});

test("the first icon loads its face, and the screen is drawn again once the face is here", async () => {
  const set = fonts();
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, set);
  note(utf8(" \uf07b src"));
  expect(set.loads.map(({ font, text }) => [font, text])).toEqual([[`16px ${ICON_FAMILY.bmp}`, "\ue0a0"]]);
  // More icons while it is on its way do not ask again.
  note(utf8(" \ue628 main.ts"));
  expect(set.loads).toHaveLength(1);
  expect(redraws).toBe(0);
  set.loads[0].resolve([{}]);
  await settle();
  expect(redraws).toBe(1);
  note(utf8(" \uf07b again"));
  await settle();
  expect(set.loads).toHaveLength(1);
  expect(redraws).toBe(1);
});

test("each face is loaded for its own icons", async () => {
  const set = fonts();
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, set);
  note(utf8("\u{f0219} notes"));
  expect(set.loads.map((load) => load.text)).toEqual(["\u{f0001}"]);
  note(utf8("\ue0b0"));
  expect(set.loads.map((load) => [load.font, load.text])).toEqual([[`16px ${ICON_FAMILY.mdi}`, "\u{f0001}"], [`16px ${ICON_FAMILY.bmp}`, "\ue0a0"]]);
  for (const load of set.loads) load.resolve([{}]);
  await settle();
  expect(redraws).toBe(2);
});

test("a face that fails to arrive is asked for again, but not on every frame", async () => {
  const set = fonts();
  let clock = 1_000;
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, set, () => clock);
  note(utf8("\uf07b"));
  set.loads[0].reject(new Error("offline"));
  await settle();
  note(utf8("\uf07b"));
  note(utf8("plain"));
  expect(set.loads).toHaveLength(1);
  clock += ICON_FONT_RETRY_MS;
  // Any frame after the wait will do: the icon is still on the screen.
  note(utf8("plain"));
  expect(set.loads).toHaveLength(2);
  set.loads[1].resolve([{}]);
  await settle();
  expect(redraws).toBe(1);
});

test("with no rule for the family there is nothing to wait for or draw", async () => {
  const set = fonts();
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, set);
  note(utf8("\uf07b"));
  set.loads[0].resolve([]);
  await settle();
  note(utf8("\uf07b"));
  expect(set.loads).toHaveLength(1);
  expect(redraws).toBe(0);
});

test("a font set that throws is a face that did not arrive, not a frame that was lost", async () => {
  let asked = 0;
  let clock = 0;
  let redraws = 0;
  const broken = { load: () => { asked++; throw new Error("no fonts here"); } } as unknown as Pick<FontFaceSet, "load">;
  const note = iconFontWatcher(() => { redraws++; }, broken, () => clock);
  expect(() => note(utf8("\uf07b"))).not.toThrow();
  await settle();
  expect(asked).toBe(1);
  clock += ICON_FONT_RETRY_MS;
  expect(() => note(utf8("\uf07b"))).not.toThrow();
  await settle();
  expect(asked).toBe(2);
  expect(redraws).toBe(0);
  // A set with no load at all is the same as no set.
  expect(() => iconFontWatcher(() => { redraws++; }, {} as Pick<FontFaceSet, "load">)(utf8("\uf07b"))).not.toThrow();
});

test("a browser without a font set is left as it was", () => {
  let redraws = 0;
  const note = iconFontWatcher(() => { redraws++; }, undefined);
  note(utf8("\uf07b"));
  expect(redraws).toBe(0);
});
