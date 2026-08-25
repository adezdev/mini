import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { grepTool, searchFiles } from "../src/tools/grep.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-grep-test-"));
  await writeFile(join(dir, "a.txt"), "hello world\nfoo bar\n");
  await writeFile(join(dir, "b.ts"), "const hello = 1;\n");
  await mkdir(join(dir, "node_modules"));
  await writeFile(join(dir, "node_modules", "c.txt"), "hello ignored\n");
  await mkdir(join(dir, "nested", "deeper"), { recursive: true });
  await writeFile(join(dir, "nested", "deeper", "d.txt"), "hello from deep\n");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("finds matches across files and reports file:line", async () => {
  const { matches } = await searchFiles(dir, { pattern: "hello" });
  const files = matches.map((m) => m.file).sort();
  assert.deepEqual(files, ["a.txt", "b.ts", "nested/deeper/d.txt"]);
});

test("skips node_modules and other always-ignored dirs", async () => {
  const { matches } = await searchFiles(dir, { pattern: "ignored" });
  assert.equal(matches.length, 0);
});

test("glob filters by filename", async () => {
  const { matches } = await searchFiles(dir, { pattern: "hello", glob: "*.ts" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, "b.ts");
});

test("literal mode treats pattern as a plain string, not regex", async () => {
  const { matches } = await searchFiles(dir, { pattern: "foo.bar", literal: true });
  assert.equal(matches.length, 0);
});

test("recurses into nested subdirectories", async () => {
  const { matches } = await searchFiles(dir, { pattern: "deep" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, "nested/deeper/d.txt");
});

test("ignoreCase matches regardless of letter case", async () => {
  const { matches } = await searchFiles(dir, { pattern: "HELLO" });
  assert.equal(matches.length, 0);
  const { matches: ci } = await searchFiles(dir, { pattern: "HELLO", ignoreCase: true });
  assert.ok(ci.length > 0);
});

test("honors custom .gitignore patterns (literal and glob)", async () => {
  const gitignoreDir = await mkdtemp(join(tmpdir(), "mini-grep-gitignore-"));
  try {
    await writeFile(join(gitignoreDir, ".gitignore"), "skip-me.txt\n*.log\n");
    await writeFile(join(gitignoreDir, "skip-me.txt"), "hello\n");
    await writeFile(join(gitignoreDir, "debug.log"), "hello\n");
    await writeFile(join(gitignoreDir, "keep.txt"), "hello\n");

    const { matches } = await searchFiles(gitignoreDir, { pattern: "hello" });
    assert.deepEqual(
      matches.map((m) => m.file),
      ["keep.txt"],
    );
  } finally {
    await rm(gitignoreDir, { recursive: true, force: true });
  }
});

test("a nonexistent search path is treated as no matches, not an error", async () => {
  const { matches, truncated } = await searchFiles(dir, { pattern: "hello", path: "does-not-exist" });
  assert.deepEqual(matches, []);
  assert.equal(truncated, false);
});

test("stops walking once the cap is already hit at the start of the next file", async () => {
  // More files than MAX_MATCHES (one match each), so no matter which order the
  // filesystem hands them back in, some files are always left over once the cap
  // fills, exercising the "already at cap when starting the next file" check.
  const capDir = await mkdtemp(join(tmpdir(), "mini-grep-cap-"));
  try {
    await Promise.all(Array.from({ length: 205 }, (_, i) => writeFile(join(capDir, `f${i}.txt`), "match\n")));

    const { matches, truncated } = await searchFiles(capDir, { pattern: "match" });
    assert.equal(matches.length, 200);
    assert.equal(truncated, true);
  } finally {
    await rm(capDir, { recursive: true, force: true });
  }
});

test("truncates at MAX_MATCHES and reports truncated:true", async () => {
  const bigDir = await mkdtemp(join(tmpdir(), "mini-grep-big-"));
  try {
    const content = `${Array.from({ length: 250 }, (_, i) => `match ${i}`).join("\n")}\n`;
    await writeFile(join(bigDir, "big.txt"), content);

    const { matches, truncated } = await searchFiles(bigDir, { pattern: "match" });
    assert.equal(truncated, true);
    assert.equal(matches.length, 200);
  } finally {
    await rm(bigDir, { recursive: true, force: true });
  }
});

test("grepTool.execute reports 'No matches found.' when nothing matches", async () => {
  const result = await grepTool.execute({ pattern: "nonexistent-pattern-xyz" }, dir);
  assert.equal(result.content, "No matches found.");
  assert.ok(!result.isError);
});

test("grepTool.execute formats results as path:line: text, one per line", async () => {
  const result = await grepTool.execute({ pattern: "hello", glob: "*.ts" }, dir);
  assert.equal(result.content, "b.ts:1: const hello = 1;");
});

test("grepTool.execute appends a truncation trailer when results are capped", async () => {
  const bigDir = await mkdtemp(join(tmpdir(), "mini-grep-tool-big-"));
  try {
    const content = `${Array.from({ length: 250 }, (_, i) => `match ${i}`).join("\n")}\n`;
    await writeFile(join(bigDir, "big.txt"), content);

    const result = await grepTool.execute({ pattern: "match" }, bigDir);
    assert.match(result.content, /\[Results truncated at 200 matches\.\]$/);
  } finally {
    await rm(bigDir, { recursive: true, force: true });
  }
});

test("grepTool.execute reports an error result for an invalid regex pattern", async () => {
  const result = await grepTool.execute({ pattern: "(unclosed" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /^Error:/);
});

test("grepTool.execute rejects a search path that escapes the project directory", async () => {
  const result = await grepTool.execute({ pattern: "hello", path: ".." }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /escapes the project directory/);
});
