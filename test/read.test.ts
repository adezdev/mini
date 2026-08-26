import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { readTool } from "../src/tools/read.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-read-test-"));
  await writeFile(join(dir, "small.txt"), "one\ntwo\nthree\n");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("reads a whole small file with 1-indexed line numbers", async () => {
  const result = await readTool.execute({ path: "small.txt" }, dir);
  assert.equal(result.content, "1\tone\n2\ttwo\n3\tthree");
  assert.ok(!result.isError);
});

test("offset/limit returns a slice with a continuation trailer", async () => {
  const result = await readTool.execute({ path: "small.txt", offset: 2, limit: 1 }, dir);
  assert.equal(result.content, "2\ttwo\n[Showing lines 2-2 of 3. Use offset=3 to continue.]");
});

test("rejects a garbled non-numeric offset instead of silently returning an empty read", async () => {
  const result = await readTool.execute({ path: "small.txt", offset: "80\n<parameter=limit>\n60" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /offset must be a number/);
});

test("rejects a non-numeric limit the same way", async () => {
  const result = await readTool.execute({ path: "small.txt", limit: "lots" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /limit must be a number/);
});

test("a file within the line limit but over the byte cap is truncated with a continuation trailer", async () => {
  // 2000 lines * ~200 bytes/line ~= 400KB, well over the 256KB byte cap, so this
  // exercises the byte-cutoff path even though it's under MAX_LINES.
  const longLine = "x".repeat(199);
  const content = `${Array.from({ length: 2000 }, () => longLine).join("\n")}\n`;
  await writeFile(join(dir, "huge.txt"), content);

  const result = await readTool.execute({ path: "huge.txt" }, dir);
  assert.match(result.content, /\[Showing lines 1-\d+ of 2000\. Use offset=\d+ to continue\.\]$/);
  const shownLines = result.content.split("\n").length - 1; // minus the trailer line
  assert.ok(shownLines < 2000);
});

test("reading a missing file returns an error result instead of throwing", async () => {
  const result = await readTool.execute({ path: "missing.txt" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /Error reading/);
});

test("reading a binary file returns an error instead of decoded garbage", async () => {
  await writeFile(join(dir, "binary.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  const result = await readTool.execute({ path: "binary.dat" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /appears to be binary/);
});

test("rejects a path that escapes the project directory", async () => {
  const result = await readTool.execute({ path: "../../etc/passwd" }, dir);
  assert.equal(result.isError, true);
  assert.match(result.content, /escapes the project directory/);
});
