import assert from "node:assert/strict";
import { test } from "node:test";
import { bashTool } from "../src/tools/bash.js";

test("returns stdout for a successful command", async () => {
  const result = await bashTool.execute({ command: "echo hello" }, process.cwd());
  assert.ok(!result.isError);
  assert.match(result.content, /hello/);
});

test("runs in the given working directory", async () => {
  const result = await bashTool.execute({ command: "pwd" }, "/tmp");
  assert.match(result.content.trim(), /\/tmp$/);
});

test("a non-zero exit code is reported as an error", async () => {
  const result = await bashTool.execute({ command: "exit 3" }, process.cwd());
  assert.equal(result.isError, true);
  assert.match(result.content, /Exit code 3/);
});

test("a command that times out is reported as an error", async () => {
  const result = await bashTool.execute({ command: "sleep 5", timeout: 100 }, process.cwd());
  assert.equal(result.isError, true);
  assert.match(result.content, /timed out/);
});

test("output over the size cap is truncated with a trailer, not an error", async () => {
  const result = await bashTool.execute({ command: "head -c 70000 /dev/zero | tr '\\0' 'a'" }, process.cwd());
  assert.ok(!result.isError);
  assert.match(result.content, /\[\.\.\. output truncated \.\.\.\]$/);
  // Capped around the 64KB limit, well under the untruncated 70000 bytes.
  assert.ok(result.content.length < 70_000);
});

test("a command that produces no output reports '(no output)'", async () => {
  const result = await bashTool.execute({ command: "true" }, process.cwd());
  assert.ok(!result.isError);
  assert.equal(result.content, "(no output)");
});

test("spawn failure (e.g. a nonexistent working directory) is reported as an error", async () => {
  const result = await bashTool.execute({ command: "echo hi" }, "/no/such/directory/at/all");
  assert.equal(result.isError, true);
  assert.match(result.content, /Failed to start command/);
});
