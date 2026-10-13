import { expect, test } from "bun:test";
import { quotaProviderOrder } from "./quota-order";

test("pinned agents lead, then the most started; a provider never used keeps no place of its own", () => {
  expect(quotaProviderOrder({ pinned: ["claude", "codex"], uses: {} })).toEqual(["codex", "claude"]);
  expect(quotaProviderOrder({ pinned: ["grok"], uses: { cursor: 9, codex: 2, claude: 2 } })).toEqual(["grok", "cursor", "codex", "claude"]);
  expect(quotaProviderOrder({ pinned: [], uses: {} })).toEqual([]);
});

test("an agent kind counts for its provider under any name the computer advertises it by", () => {
  expect(quotaProviderOrder({ pinned: ["agy"], uses: { "cursor-agent": 3, "cursor": 2, "copilot-cli": 4, pi: 50, "": 7 } }))
    .toEqual(["antigravity", "cursor", "copilot"]);
});
