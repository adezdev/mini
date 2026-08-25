import assert from "node:assert/strict";
import { test } from "node:test";
import { unifiedDiff } from "../src/tools/diff.js";

test("identical texts produce no hunks", () => {
  const diff = unifiedDiff("a\nb\nc\n", "a\nb\nc\n");
  assert.equal(diff, "--- before\n+++ after\n");
});

test("a single-line insertion produces one hunk with a + line", () => {
  const diff = unifiedDiff("a\nb\nc\n", "a\nx\nb\nc\n");
  assert.match(diff, /^--- before\n\+\+\+ after\n@@ -1,3 \+1,4 @@\n/);
  assert.match(diff, /\n\+x\n/);
  assert.match(diff, / a\n/);
  assert.match(diff, / b\n/);
});

test("a trailing newline on both sides does not produce a phantom empty context line", () => {
  const diff = unifiedDiff("a\nb\nc\n", "a\nx\nb\nc\n");
  assert.doesNotMatch(diff, /\n \n/);
  assert.ok(diff.endsWith("c\n"));
});

test("a single-line deletion produces one hunk with a - line and no + lines", () => {
  const diff = unifiedDiff("a\nb\nc\n", "a\nc\n");
  assert.match(diff, /\n-b\n/);
  const body = diff.slice(diff.indexOf("@@"));
  assert.doesNotMatch(body, /\n\+/);
});

test("changes far apart produce two separate hunks", () => {
  const oldText = `${Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")}\n`;
  const lines = oldText.split("\n");
  lines[0] = "CHANGED_START";
  lines[19] = "CHANGED_END";
  const newText = lines.join("\n");

  const diff = unifiedDiff(oldText, newText);
  const hunkCount = (diff.match(/^@@/gm) ?? []).length;
  assert.equal(hunkCount, 2);
});

test("a pure rename-like replacement keeps unchanged lines as context", () => {
  const diff = unifiedDiff("foo\nbar\nbaz\n", "foo\nqux\nbaz\n");
  assert.match(diff, /-bar/);
  assert.match(diff, /\+qux/);
  assert.match(diff, / foo/);
  assert.match(diff, / baz/);
});
