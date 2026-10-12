import { describe, expect, test } from "bun:test";
import { parseDiffLines } from "./workspace";

const kinds = (patch: string) => parseDiffLines(patch).filter((line) => line.kind !== "meta")
  .map((line) => `${line.kind}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}:${line.text}`);

describe("patch lines", () => {
  test("a changed line is what its first column says, whatever its text", () => {
    // A removed SQL comment reads "--- …", an added "++j;" reads "+++j;": neither is a file header.
    const patch = "diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1,4 +1,4 @@\n one\n--- a sql comment\n+++j;\n select 1;\n six\n";
    expect(kinds(patch)).toEqual([
      "hunk:-:-:@@ -1,4 +1,4 @@",
      "context:1:1:one",
      "delete:2:-:-- a sql comment",
      "add:-:2:++j;",
      "context:3:3:select 1;",
      "context:4:4:six",
    ]);
  });

  test("the file's own header is not part of any hunk", () => {
    const lines = parseDiffLines("diff --git a/a b/a\nindex 1..2 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n");
    expect(lines.slice(0, 4).every((line) => line.kind === "meta")).toBe(true);
    expect(lines.slice(4).map((line) => line.kind)).toEqual(["hunk", "delete", "add"]);
  });

  test("a blank unchanged line that lost its space still counts", () => {
    expect(kinds("@@ -1,3 +1,4 @@\n a\n\n b\n+c")).toEqual([
      "hunk:-:-:@@ -1,3 +1,4 @@", "context:1:1:a", "context:2:2:", "context:3:3:b", "add:-:4:c",
    ]);
  });

  test("the missing final line break is said of the line it follows", () => {
    const lines = parseDiffLines("@@ -1 +1 @@\n-last\n\\ No newline at end of file\n+last\n");
    expect(lines.map((line) => line.kind)).toEqual(["hunk", "delete", "meta", "add"]);
    expect(lines[1].noEol).toBe(true);
    expect(lines[3].noEol).toBeUndefined();
  });

  test("a conflict's combined diff is read against our side", () => {
    const patch = [
      "diff --cc tracked.txt", "index 1,2..0", "--- a/tracked.txt", "+++ b/tracked.txt",
      "@@@ -1,4 -1,4 +1,7 @@@ fn main",
      "  same",
      "++<<<<<<< HEAD",
      " +ours",
      "- gone from ours",
      " -only theirs had it",
      "++=======",
      "+ theirs",
      "++>>>>>>> other",
      "  end",
    ].join("\n");
    expect(kinds(patch)).toEqual([
      "hunk:-:-:@@ -1,4 +1,7 @@ fn main",
      "context:1:1:same",
      "add:-:2:<<<<<<< HEAD",
      // Ours has this line already: its number passes without being shown.
      "add:-:3:ours",
      "delete:3:-:gone from ours",
      "delete:-:-:only theirs had it",
      "add:-:4:=======",
      "add:-:5:theirs",
      "add:-:6:>>>>>>> other",
      "context:4:7:end",
    ]);
  });

  test("what is not a patch line inside a hunk is left out, and a new file header ends the hunk", () => {
    expect(kinds("@@ -1 +1 @@\n a\n?garbage\ndiff --git a/b b/b\n+not a line\n")).toEqual(["hunk:-:-:@@ -1 +1 @@", "context:1:1:a"]);
  });

  test("a header keeps what Git names after the range, line separators included", () => {
    expect(kinds("@@ -1 +1 @@ title rest\r\n+a")[0]).toBe("hunk:-:-:@@ -1 +1 @@ title rest\r");
  });
});
