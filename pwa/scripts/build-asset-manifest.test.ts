import { expect, test } from "bun:test";
import { assetGraph } from "./build-asset-manifest";

test("startup excludes deferred features while every chunk carries its own offline dependencies", () => {
  const graph = assetGraph({
    "index.html": { isEntry: true, file: "assets/app-a.js", imports: ["shared"], dynamicImports: ["session"] },
    shared: { file: "assets/shared-b.js", css: ["assets/base-b.css"] },
    session: { file: "assets/session-c.js", imports: ["shared"], css: ["assets/session-c.css"], dynamicImports: ["scanner"] },
    scanner: { file: "assets/scanner-d.js" },
  });
  expect(graph.startup).toEqual(["/assets/app-a.js", "/assets/base-b.css", "/assets/shared-b.js"]);
  expect(graph.chunks["/assets/session-c.js"]).toEqual([
    "/assets/base-b.css", "/assets/session-c.css", "/assets/session-c.js", "/assets/shared-b.js",
  ]);
  expect(graph.chunks["/assets/session-c.js"]).not.toContain("/assets/scanner-d.js");
});

test("a missing dependency or a path outside generated assets fails the build", () => {
  expect(() => assetGraph({ "index.html": { isEntry: true, file: "assets/a.js", imports: ["missing"] } })).toThrow();
  expect(() => assetGraph({ "index.html": { isEntry: true, file: "../secret.js" } })).toThrow();
});

test("the icon faces are cacheable files that no chunk waits for", () => {
  const face = "assets/symbols-nerd-font-bmp-BZeCxFc0.woff2";
  const graph = assetGraph({
    "index.html": { isEntry: true, file: "assets/app-a.js", css: ["assets/app-a.css"], assets: [face], dynamicImports: ["session"] },
    session: { file: "assets/session-c.js", imports: ["index.html"], assets: [face] },
    "src/shared/ui/fonts/symbols-nerd-font-bmp.woff2": { file: face },
  });
  expect(graph.startup).toEqual(["/assets/app-a.css", "/assets/app-a.js"]);
  expect(graph.chunks["/assets/session-c.js"]).toEqual(["/assets/app-a.css", "/assets/app-a.js", "/assets/session-c.js"]);
  expect(graph.chunks[`/${face}`]).toEqual([`/${face}`]);
});
