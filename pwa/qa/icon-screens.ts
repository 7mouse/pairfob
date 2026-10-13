/**
 * A pane whose shell is set up with a Nerd Font: a Powerline prompt, a file
 * listing with icons, a prompt line with icons from both faces and a status
 * bar with round and slanted caps. The guided pane reads it as text; the
 * complete terminal is sent the same rows by cursor address.
 *
 * Every icon is followed by a space, as a program writes it, except in the row
 * that packs them between bars to show each one keeps to its cell.
 */

const ESC = "\u001b";
const R = `${ESC}[0m`;
const sgr = (...codes: number[]) => `${ESC}[${codes.join(";")}m`;

/** `~/work/pairfob  main  ✚2 `, each segment closed by a separator in the colour it leaves. */
const PROMPT = [
  sgr(44, 97), " ~/work/pairfob ", sgr(0, 34, 42), "\ue0b0", sgr(30), " \ue0a0 main ",
  sgr(0, 32, 43), "\ue0b0", sgr(30), " ✚2 ", sgr(0, 33), "\ue0b0", R, " eza --icons",
].join("");

const LISTING = [
  `${sgr(34)}\uf07b${R} src           ${sgr(36)}\ue628${R} main.ts       ${sgr(33)}\ue60b${R} package.json`,
  `${sgr(34)}\uf115${R} scripts       ${sgr(31)}\ue7a8${R} lib.rs        ${sgr(32)}\uf023${R} bun.lock`,
  `${sgr(37)}\uf48a${R} README.md     ${sgr(33)}\ue73c${R} tools.py      ${sgr(36)}\uf308${R} Dockerfile`,
];

/** A prompt in the starship style: icons from the basic plane and from Material Design. */
const STATUS = `${sgr(1, 36)}~/work/pairfob${R} on ${sgr(1, 35)}\ue0a0 main${R} ${sgr(1, 31)}[!?]${R} via ${sgr(1, 32)}\ue718 v22.4.0${R} ${sgr(2)}\u{f051b} 3s${R}`;

const MATERIAL = `${sgr(2)}\u{f0219} notes.md   \u{f02a2} git   \u{f0320} python   \u23fb power${R}`;

/** Each icon between bars: a bar that moved would show an icon taking more than its cell. */
const PACKED = "|\uf07b|\uf115|\ue628|\ue60b|\ue7a8|\uf023|\u{f0219}|\u23fb|0123456789|";

/** A status bar in the lualine style: round caps, a slanted join, and thin separators inside a segment. */
const BAR = [
  sgr(34), "\ue0b6", sgr(44, 30, 1), " NORMAL ", sgr(0, 34, 100), "\ue0b4", sgr(97), " \ue0a0 main ", sgr(90, 40), "\ue0bc",
  sgr(37), " src/app.ts ", sgr(90), "\ue0b1", sgr(37), " utf-8 ", sgr(90), "\ue0b3", sgr(37), " ts ", sgr(34), "\ue0b2", sgr(44, 30), " 42:7 ", sgr(0, 34), "\ue0b4", R,
].join("");

const AGENT = [
  `${sgr(32)}⏺${R} Update(src/app.ts)`,
  `  ⎿  Wrote 3 lines`,
  `${sgr(33)}✻${R} Thinking…`,
];

export const ICON_ROWS = [PROMPT, ...LISTING, "", STATUS, MATERIAL, PACKED, "", BAR, "", ...AGENT, "", "❯ "];

export const ICON_PANE_TEXT = ICON_ROWS.join("\n");

/**
 * The same rows as the pane's complete terminal shows them: at the foot of the
 * grid, where a shell's last output and its prompt are, and where a phone that
 * shows part of a tall grid is looking.
 */
export function iconScreen(_cols: number, rows: number): string {
  const shown = ICON_ROWS.slice(-rows);
  const first = rows - shown.length + 1;
  return `${ESC}[2J${ESC}[H` + shown.map((line, index) => `${ESC}[${first + index};1H${line}`).join("");
}
