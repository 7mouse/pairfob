import { expect, test } from "bun:test";
import { startupAssets, type BuildManifest } from "./performance-budget";

test("startup budget follows every static dependency and shared stylesheet once", () => {
  const manifest: BuildManifest = {
    "index.html": { file: "assets/main.js", isEntry: true, imports: ["react", "shell"], dynamicImports: ["workspace"] },
    react: { file: "assets/react.js", css: ["assets/common.css"] },
    shell: { file: "assets/shell.js", imports: ["react"], css: ["assets/common.css", "assets/shell.css"] },
    workspace: { file: "assets/workspace.js", imports: ["react"], css: ["assets/workspace.css"] },
  };
  expect(startupAssets(manifest)).toEqual([
    "assets/common.css", "assets/main.js", "assets/react.js", "assets/shell.css", "assets/shell.js",
  ]);
  // Moving code into a statically imported chunk cannot evade the budget.
  manifest["index.html"].imports!.push("workspace");
  expect(startupAssets(manifest)).toContain("assets/workspace.js");
  expect(startupAssets(manifest)).toContain("assets/workspace.css");
});

test("incomplete build evidence fails closed and cyclic imports terminate", () => {
  expect(() => startupAssets({})).toThrow("Missing application entry");
  const manifest: BuildManifest = {
    "index.html": { file: "assets/main.js", isEntry: true, imports: ["a"] },
    a: { file: "assets/a.js", imports: ["index.html", "missing"] },
  };
  expect(() => startupAssets(manifest)).toThrow("Missing static dependency");
  manifest.a.imports!.pop();
  expect(startupAssets(manifest)).toEqual(["assets/a.js", "assets/main.js"]);
});
