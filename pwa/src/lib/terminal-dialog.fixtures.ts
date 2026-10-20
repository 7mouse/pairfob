/** Screens captured from Codex v0.159.2 in tmux (100×40), paths shortened. */
export const CODEX_TRUST_SCREEN = [
  "  Folder access",
  "  /tmp/demo",
  "  /scratchpad/codexprompt.ua3k",
  "",
  "  Trust this folder? Codex can read, edit, and run files here, subject to your permission",
  "  settings. Folder settings can run code automatically, even without a model request. Continue",
  "  only if you trust these files. Your trust decision will be saved.",
  "",
  "› 1. Trust and continue",
  "  2. Back to Agent Command Center",
  "",
  "  enter continue · esc back"
].join("\n");

export const CODEX_APPROVAL_SCREEN = [
  "  >_ OpenAI Codex (v0.159.2)",
  "     /tmp/…/scratchpad/codexprompt.ua3k",
  "",
  "  Shall we turn “huh?” into “aha!”?",
  "",
  "",
  "› Create an empty file named hello.txt in this folder with the shell command touch hello.txt",
  "",
  "",
  "• I’ll create hello.txt in this folder.",
  "",
  "• Running touch hello.txt",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "  Would you like to run the following command?",
  "",
  "  Environment: local",
  "",
  "  Reason: Allow creating hello.txt in this folder? The workspace is read-only, so this command",
  "  requires write permission.",
  "",
  "  $ touch hello.txt",
  "",
  "",
  "› 1. Yes, proceed (y)",
  "  2. Yes, and don't ask again for commands that start with `touch hello.txt` (p)",
  "  3. No, and tell Codex what to do differently (esc)",
  "",
  "  Press enter to confirm or esc to cancel"
].join("\n");

/**
 * Screens captured from Grok Build 1.0.62 in tmux, ask_user_question, 2026-10-20.
 * The highlight is a background colour only, so text shows no cursor; the █
 * column is Grok's scrollbar. Pressing an option's digit answers it.
 */
export const GROK_QUESTION_SCREEN = [
  "   ◆ Waiting on answers for Which color?                                        7.6s ⇣21.6k [stop]",
  "",
  "  ┃",
  "  ┃  Which color?",
  "  ┃",
  "  ┃",
  "  ┃  1 (○) Red    A warm primary color.                                                          █",
  "  ┃  2 (○) Green  A cool primary color.                                                          █",
  "  ┃  3 (○) Blue   A calm primary color.                                                          █",
  "  ┃  z (○) Type your answer here",
  "  ┃",
  "  ┃  ↑/↓ navigate · y copy                                                        Enter:submit",
  "  ┃",
  "",
  "  Tab:next answer  │  Esc:scrollback  │  Shift+x:dismiss",
  ""
].join("\n");

/** The first of two questions in one call, 50 columns wide: the highlighted option's description wraps. */
export const GROK_NARROW_SCREEN = [
  "     ◆ Ask 2 questions",
  "",
  "   ◆ Waiting on answers for…   13s ⇣22.1k [stop]",
  "",
  "  ┃",
  "  ┃  Which color?",
  "  ┃",
  "  ┃",
  "  ┃  1 (○) Red    A warm primary hue often     █",
  "  ┃               used for alerts, emphasis,   █",
  "  ┃               and strong attention.        █",
  "  ┃  2 (○) Green  A cool natural hue often…    █",
  "  ┃  3 (○) Blue   A cool primary hue often…    █",
  "  ┃  z (○) Type your answer here",
  "  ┃",
  "  ┃  [1/2] ↑/↓ navigate · ←/→ q Enter:select py",
  "  ┃",
  "",
  "  Tab:next answer  │  Esc:scrollback  │  Shift+x"
].join("\n");

/**
 * Captured from Pi 1.3.0 in tmux (100×30): an extension select dialog. The
 * cursor row is "→", the rows carry no digits, and ↑↓/enter/escape answer it.
 */
export const PI_SELECTOR_SCREEN = [
  " Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.",
  "",
  "────────────────────────────────────────────────────────────────────────────────────────────────────",
  "",
  " Allow dangerous command?",
  "",
  " → Allow",
  "   Block",
  "",
  " ↑↓ navigate  enter select  escape/ctrl+c cancel",
  "",
  "────────────────────────────────────────────────────────────────────────────────────────────────────",
].join("\n");

/** The same dialog at 48 columns: both labels wrap under their first line. */
export const PI_SELECTOR_NARROW_SCREEN = [
  " Pi can explain its own features and look up",
  " its docs. Ask it how to use or extend Pi.",
  "",
  "────────────────────────────────────────────────",
  "",
  " Allow dangerous command?",
  "",
  " → Allow once and remember this command for the",
  " rest of the session",
  "   Block and tell the agent what to do",
  " differently",
  "",
  " ↑↓ navigate  enter select  escape/ctrl+c",
  " cancel",
  "",
  "────────────────────────────────────────────────",
].join("\n");
