import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { lsTool } from "../src/tools/ls.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-ls-test-"));
  await writeFile(join(dir, "b.txt"), "");
  await writeFile(join(dir, "a.txt"), "");
  await mkdir(join(dir, "sub"));
  await mkdir(join(dir, "node_modules"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("lists files and directories sorted, with trailing slash on dirs", async () => {
  const result = await lsTool.execute({}, dir);
  assert.equal(result.content, "a.txt\nb.txt\nsub/");
});

test("skips always-ignored directories like node_modules", async () => {
  const result = await lsTool.execute({}, dir);
  assert.doesNotMatch(result.content, /node_modules/);
});

test("lists a subdirectory when path is given", async () => {
  await writeFile(join(dir, "sub", "nested.txt"), "");
  const result = await lsTool.execute({ path: "sub" }, dir);
  assert.equal(result.content, "nested.txt");
});

test("errors gracefully on a missing directory", async () => {
  const result = await lsTool.execute({ path: "does-not-exist" }, dir);
  assert.equal(result.isError, true);
});
