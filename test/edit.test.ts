import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { applyEdits, editTool } from "../src/tools/edit.js";

test("applyEdits: single unique match succeeds", () => {
  const result = applyEdits("hello world\ngoodbye world\n", [{ oldText: "hello", newText: "hi" }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.result, "hi world\ngoodbye world\n");
  }
});

test("applyEdits: zero matches fails", () => {
  const result = applyEdits("hello world\n", [{ oldText: "missing", newText: "x" }]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not found/);
  }
});

test("applyEdits: multiple matches fails", () => {
  const result = applyEdits("world world\n", [{ oldText: "world", newText: "x" }]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /matches 2 times/);
  }
});

test("applyEdits: multiple edits apply against original content, not chained", () => {
  const original = "AAA\nBBB\nCCC\n";
  const result = applyEdits(original, [
    { oldText: "AAA", newText: "BBB" },
    { oldText: "CCC", newText: "AAA" },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.result, "BBB\nBBB\nAAA\n");
  }
});

test("applyEdits: multiple edits fail together if any oldText is ambiguous", () => {
  const original = "x\nx\ny\n";
  const result = applyEdits(original, [
    { oldText: "y", newText: "z" },
    { oldText: "x", newText: "w" },
  ]);
  assert.equal(result.ok, false);
});

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-edit-tool-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("editTool.execute applies a change, writes the file, and returns a diff", async () => {
  const filePath = join(dir, "a.txt");
  await writeFile(filePath, "hello world\n");

  const result = await editTool.execute({ path: "a.txt", edits: [{ oldText: "hello", newText: "goodbye" }] }, dir);

  assert.ok(!result.isError);
  assert.match(result.content, /^--- before\n\+\+\+ after\n/);
  assert.equal(await readFile(filePath, "utf-8"), "goodbye world\n");
});

test("editTool.execute preserves CRLF line endings on write", async () => {
  const filePath = join(dir, "crlf.txt");
  await writeFile(filePath, "one\r\ntwo\r\nthree\r\n");

  const result = await editTool.execute({ path: "crlf.txt", edits: [{ oldText: "two", newText: "TWO" }] }, dir);

  assert.ok(!result.isError);
  assert.equal(await readFile(filePath, "utf-8"), "one\r\nTWO\r\nthree\r\n");
});

test("editTool.execute applies multiple edits in one call", async () => {
  const filePath = join(dir, "multi.txt");
  await writeFile(filePath, "AAA\nBBB\nCCC\n");

  const result = await editTool.execute(
    {
      path: "multi.txt",
      edits: [
        { oldText: "AAA", newText: "111" },
        { oldText: "CCC", newText: "333" },
      ],
    },
    dir,
  );

  assert.ok(!result.isError);
  assert.equal(await readFile(filePath, "utf-8"), "111\nBBB\n333\n");
});

test("editTool.execute returns an error for a missing file without writing anything", async () => {
  const result = await editTool.execute({ path: "does-not-exist.txt", edits: [{ oldText: "x", newText: "y" }] }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /Error reading/);
});

test("editTool.execute returns an error when oldText doesn't match, and leaves the file untouched", async () => {
  const filePath = join(dir, "unchanged.txt");
  await writeFile(filePath, "original content\n");

  const result = await editTool.execute(
    { path: "unchanged.txt", edits: [{ oldText: "missing text", newText: "x" }] },
    dir,
  );

  assert.equal(result.isError, true);
  assert.match(result.content, /not found/);
  assert.equal(await readFile(filePath, "utf-8"), "original content\n");
});

test("editTool.execute returns an error when oldText matches more than once", async () => {
  const filePath = join(dir, "ambiguous.txt");
  await writeFile(filePath, "dup\ndup\n");

  const result = await editTool.execute({ path: "ambiguous.txt", edits: [{ oldText: "dup", newText: "x" }] }, dir);

  assert.equal(result.isError, true);
  assert.match(result.content, /matches 2 times/);
});

test("rejects a path that escapes the project directory", async () => {
  const result = await editTool.execute({ path: "../outside.txt", edits: [{ oldText: "a", newText: "b" }] }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /escapes the project directory/);
});
