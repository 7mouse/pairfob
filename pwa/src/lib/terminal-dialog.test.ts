import { expect, test } from "bun:test";
import { dialogKeys, parseTerminalDialog, screenExcerpt } from "./terminal-dialog";
import { CODEX_APPROVAL_SCREEN, CODEX_TRUST_SCREEN, GROK_NARROW_SCREEN, GROK_QUESTION_SCREEN } from "./terminal-dialog.fixtures";

const claudeBoxed = `
 > clean up the build

╭──────────────────────────────────────────────────────────────╮
│ Bash command                                                 │
│                                                              │
│   rm -rf pwa/dist && bun run build                           │
│   Remove the build output and rebuild                        │
│                                                              │
│ Do you want to proceed?                                      │
│ ❯ 1. Yes                                                     │
│   2. Yes, and don't ask again for rm commands in             │
│      /Users/me/repo                                          │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
`;

const codex = `
  Would you like to run the following command?

  $ rm -rf dist

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;

test("a boxed Claude Code permission prompt yields its question, options and context", () => {
  const dialog = parseTerminalDialog(claudeBoxed)!;
  expect(dialog.question).toBe("Do you want to proceed?");
  expect(dialog.options.map((option) => [option.number, option.label, option.selected])).toEqual([
    [1, "Yes", true],
    [2, "Yes, and don't ask again for rm commands in", false],
    [3, "No, and tell Claude what to do differently (esc)", false],
  ]);
  expect(dialog.context).toContain("rm -rf pwa/dist && bun run build");
  // The guard needs the question verbatim on the raw screen.
  expect(claudeBoxed.includes(dialog.question)).toBeTrue();
});

test("a Codex approval list parses with its own selection marker", () => {
  const dialog = parseTerminalDialog(codex)!;
  expect(dialog.question).toBe("$ rm -rf dist");
  expect(dialog.options.map((option) => option.selected)).toEqual([true, false, false]);
  expect(dialog.context).toEqual(["Would you like to run the following command?"]);
});

test("keys move from the highlighted option to the chosen one, then confirm", () => {
  const dialog = parseTerminalDialog(codex)!;
  expect(dialogKeys(dialog, 1)).toEqual(["enter"]);
  expect(dialogKeys(dialog, 3)).toEqual(["down", "down", "enter"]);
  const moved = { ...dialog, options: dialog.options.map((option) => ({ ...option, selected: option.number === 3 })) };
  expect(dialogKeys(moved, 1)).toEqual(["up", "up", "enter"]);
});

test("ordinary output with numbers is not a dialog", () => {
  expect(parseTerminalDialog("Steps:\n1. build\nall good\n> ")).toBeNull();
  expect(parseTerminalDialog("2. second\n3. third")).toBeNull();
  expect(parseTerminalDialog("")).toBeNull();
});

test("a non-list prompt falls back to the last screen lines without borders", () => {
  expect(screenExcerpt("╭────╮\n│ Trust this folder? │\n│ (y/n) │\n╰────╯\n", 3)).toEqual(["Trust this folder?", "(y/n)"]);
});

test("a scrollbar thumb at the right edge is not screen content", () => {
  const thumb = " ".repeat(51) + "█";
  const screen = [thumb, thumb, "", thumb, " You hit your weekly limit." + " ".repeat(20) + "█", " 2 Try Again"].join("\n");
  expect(screenExcerpt(screen)).toEqual([" You hit your weekly limit.", " 2 Try Again"]);
  // A bar drawn as part of the text stays.
  expect(screenExcerpt("progress ████")).toEqual(["progress ████"]);
});

test("a numbered list in the agent's prose above another prompt is not a dialog", () => {
  const prose = "⏺ Here is the plan:\n  1. Refactor\n  2. Add tests\n  3. Ship it\n\nProceed? (y/n)\n";
  expect(parseTerminalDialog(prose)).toBeNull();
  // A list without the selection marker is not a live prompt either.
  expect(parseTerminalDialog("Do you want to proceed?\n  1. Yes\n  2. No\n")).toBeNull();
});

test("an option wrapped over several lines keeps the options below it and the marker", () => {
  const screen = [
    " Do you want to proceed?",
    "   1. Yes",
    "   2. Yes, and don't ask again for commands",
    "      that touch /Users/me/repo/pwa/dist and",
    "      /Users/me/repo/pwa/node_modules",
    " ❯ 3. No, and tell Claude what to do differently (esc)",
  ].join("\n");
  const dialog = parseTerminalDialog(screen)!;
  expect(dialog.options.map((option) => [option.number, option.selected])).toEqual([[1, false], [2, false], [3, true]]);
  expect(dialogKeys(dialog, 1)).toEqual(["up", "up", "enter"]);
});

test("real Codex screens: the folder-trust prompt and a command approval", () => {
  const trust = parseTerminalDialog(CODEX_TRUST_SCREEN)!;
  expect(trust.options.map((option) => [option.label, option.selected])).toEqual([["Trust and continue", true], ["Back to Agent Command Center", false]]);
  expect(CODEX_TRUST_SCREEN.includes(trust.question)).toBeTrue();
  const approval = parseTerminalDialog(CODEX_APPROVAL_SCREEN)!;
  expect(approval.question).toBe("$ touch hello.txt");
  expect(approval.context[0]).toBe("Would you like to run the following command?");
  expect(approval.options.map((option) => option.number)).toEqual([1, 2, 3]);
  // Verified on the live TUI: two downs and enter chose "No" and cancelled the command.
  expect(dialogKeys(approval, 3)).toEqual(["down", "down", "enter"]);
});

test("real Grok screens: radio options are answered by their digit", () => {
  const dialog = parseTerminalDialog(GROK_QUESTION_SCREEN)!;
  expect(dialog.question).toBe("Which color?");
  expect(dialog.context).toEqual([]);
  expect(dialog.direct).toBeTrue();
  expect(dialog.options.map((option) => [option.number, option.label, option.selected])).toEqual([
    [1, "Red", false], [2, "Green", false], [3, "Blue", false],
  ]);
  expect(GROK_QUESTION_SCREEN.includes(dialog.question)).toBeTrue();
  // Verified on the live TUI: "3" answered Blue without moving the highlight first.
  expect(dialogKeys(dialog, 3)).toEqual(["3"]);
  // Narrow, the highlighted option's description wraps under its label and a scrollbar runs down the side.
  const narrow = parseTerminalDialog(GROK_NARROW_SCREEN)!;
  expect(narrow.options.map((option) => option.label)).toEqual(["Red", "Green", "Blue"]);
  expect(narrow.question).toBe("Which color?");
});

test("Grok's weekly-limit prompt offers its two choices", () => {
  const screen = [
    "  ┃",
    "  ┃  You hit your weekly limit.",
    "  ┃  1 (○) Buy more credits  Purchase credits to keep using Grok Build",
    "  ┃  2 (○) Try Again         Resubmit the last prompt once you have usage again",
    "  ┃  ↑/↓ navigate · y copy                    Enter:submit",
    "  Tab:next answer  │  Esc:scrollback  │",
  ].join("\n");
  const dialog = parseTerminalDialog(screen)!;
  expect(dialog.question).toBe("You hit your weekly limit.");
  expect(dialog.options.map((option) => option.label)).toEqual(["Buy more credits", "Try Again"]);
  expect(dialogKeys(dialog, 2)).toEqual(["2"]);
});

test("a list mixing Grok radios and numbered lines is not a dialog", () => {
  expect(parseTerminalDialog("Pick one\n› 1. Yes\n  2 (○) No\n")).toBeNull();
});
