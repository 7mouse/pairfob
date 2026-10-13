import { expect, test } from "bun:test";
import { dependencyAssets, startupAssets, type BuildManifest } from "./performance-budget";

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

test("a chunk's images are in its closure; the on-demand icon faces are in none", () => {
  const manifest: BuildManifest = {
    "index.html": {
      file: "assets/main.js", isEntry: true, imports: ["session"],
      assets: ["assets/logo-Ab12Cd34.png", "assets/symbols-nerd-font-bmp-BZeCxFc0.woff2", "assets/symbols-nerd-font-mdi-DOOFW8yZ.woff2"],
    },
    session: { file: "assets/session.js", assets: ["assets/symbols-nerd-font-bmp-BZeCxFc0.woff2"] },
    "src/shared/ui/fonts/symbols-nerd-font-bmp.woff2": { file: "assets/symbols-nerd-font-bmp-BZeCxFc0.woff2" },
  };
  expect(startupAssets(manifest)).toEqual(["assets/logo-Ab12Cd34.png", "assets/main.js", "assets/session.js"]);
  expect(dependencyAssets(manifest, "session")).toEqual(["assets/session.js"]);
  // Asked for by name, a face is still a file the worker may cache.
  expect(dependencyAssets(manifest, "src/shared/ui/fonts/symbols-nerd-font-bmp.woff2")).toEqual(["assets/symbols-nerd-font-bmp-BZeCxFc0.woff2"]);
  // Any other face is text someone has to read: it stays in the closure.
  manifest["index.html"].assets!.push("assets/inter-Qw12Er34.woff2");
  expect(startupAssets(manifest)).toContain("assets/inter-Qw12Er34.woff2");
});
