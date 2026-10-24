import { expect, test } from "bun:test";
import { legacyBuild, newerRelease, releaseParts, sameRelease } from "./daemon-version";
test("numeric releases compare numerically and never downgrade unknown builds", () => {
  expect(newerRelease("2026-09-07.10", "2026-09-07.9")).toBeTrue();
  expect(newerRelease("v1.10.0", "1.9.0")).toBeTrue();
  for (const [a,b] of [["1.0.0","1.0.0"],["1.0.0","2.0.0"],["1.0.0","dev"],["1.0.0","1.0.0-rc1"],["2026-09-07.1","1.0.0"]]) expect(newerRelease(a,b)).toBeFalse();
  expect(releaseParts("<html>error</html>")).toBeNull();
  expect(legacyBuild("0.1.0")).toBeTrue();
  expect(legacyBuild("dev")).toBeFalse();
});
test("release equality ignores the optional v prefix without guessing unknown versions", () => {
  expect(sameRelease("v1.4.5", "1.4.5")).toBeTrue();
  for (const [a, b] of [["v1.4.5", "v1.4.4"], ["1.4", "1.4.0"], ["dev", "dev"], ["", ""]]) {
    expect(sameRelease(a, b)).toBeFalse();
  }
});
