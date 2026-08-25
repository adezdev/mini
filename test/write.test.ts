import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { writeTool } from "../src/tools/write.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-write-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("creates a new file with the given content", async () => {
  const result = await writeTool.execute({ path: "new.txt", content: "hello\n" }, dir);
  assert.ok(!result.isError);
  assert.equal(await readFile(join(dir, "new.txt"), "utf-8"), "hello\n");
});

test("overwrites an existing file", async () => {
  await writeTool.execute({ path: "existing.txt", content: "first" }, dir);
  await writeTool.execute({ path: "existing.txt", content: "second" }, dir);
  assert.equal(await readFile(join(dir, "existing.txt"), "utf-8"), "second");
});

test("creates intermediate directories as needed", async () => {
  await writeTool.execute({ path: "a/b/c.txt", content: "deep" }, dir);
  assert.equal(await readFile(join(dir, "a/b/c.txt"), "utf-8"), "deep");
});
