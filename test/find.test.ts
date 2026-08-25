import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { findFiles, findTool } from "../src/tools/find.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-find-test-"));
  await writeFile(join(dir, "a.txt"), "");
  await writeFile(join(dir, "b.ts"), "");
  await mkdir(join(dir, "node_modules"));
  await writeFile(join(dir, "node_modules", "c.ts"), "");
  await mkdir(join(dir, "nested", "deeper"), { recursive: true });
  await writeFile(join(dir, "nested", "deeper", "d.ts"), "");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("matches files by basename glob, recursively", async () => {
  const { files } = await findFiles(dir, { pattern: "*.ts" });
  assert.deepEqual(files, ["b.ts", "nested/deeper/d.ts"]);
});

test("skips node_modules and other always-ignored dirs", async () => {
  const { files } = await findFiles(dir, { pattern: "c.ts" });
  assert.equal(files.length, 0);
});

test("a pattern containing '/' matches against the full relative path", async () => {
  const { files } = await findFiles(dir, { pattern: "nested/*/*.ts" });
  assert.deepEqual(files, ["nested/deeper/d.ts"]);

  const { files: noMatch } = await findFiles(dir, { pattern: "deeper/*.ts" });
  assert.deepEqual(noMatch, []);
});

test("honors custom .gitignore patterns", async () => {
  const gitignoreDir = await mkdtemp(join(tmpdir(), "mini-find-gitignore-"));
  try {
    await writeFile(join(gitignoreDir, ".gitignore"), "skip-me.txt\n");
    await writeFile(join(gitignoreDir, "skip-me.txt"), "");
    await writeFile(join(gitignoreDir, "keep.txt"), "");

    const { files } = await findFiles(gitignoreDir, { pattern: "*.txt" });
    assert.deepEqual(files, ["keep.txt"]);
  } finally {
    await rm(gitignoreDir, { recursive: true, force: true });
  }
});

test("a nonexistent search path is treated as no matches, not an error", async () => {
  const { files, truncated } = await findFiles(dir, { pattern: "*.ts", path: "does-not-exist" });
  assert.deepEqual(files, []);
  assert.equal(truncated, false);
});

test("truncates at MAX_RESULTS and reports truncated:true", async () => {
  const bigDir = await mkdtemp(join(tmpdir(), "mini-find-big-"));
  try {
    await Promise.all(Array.from({ length: 250 }, (_, i) => writeFile(join(bigDir, `f${i}.txt`), "")));

    const { files, truncated } = await findFiles(bigDir, { pattern: "*.txt" });
    assert.equal(truncated, true);
    assert.equal(files.length, 200);
  } finally {
    await rm(bigDir, { recursive: true, force: true });
  }
});

test("findTool.execute reports 'No files found.' when nothing matches", async () => {
  const result = await findTool.execute({ pattern: "nonexistent-*.xyz" }, dir);
  assert.equal(result.content, "No files found.");
  assert.ok(!result.isError);
});

test("findTool.execute lists matching paths, one per line", async () => {
  const result = await findTool.execute({ pattern: "*.ts" }, dir);
  assert.equal(result.content, "b.ts\nnested/deeper/d.ts");
});

test("findTool.execute appends a truncation trailer when results are capped", async () => {
  const bigDir = await mkdtemp(join(tmpdir(), "mini-find-tool-big-"));
  try {
    await Promise.all(Array.from({ length: 250 }, (_, i) => writeFile(join(bigDir, `f${i}.txt`), "")));

    const result = await findTool.execute({ pattern: "*.txt" }, bigDir);
    assert.match(result.content, /\[Results truncated at 200 files\.\]$/);
  } finally {
    await rm(bigDir, { recursive: true, force: true });
  }
});
