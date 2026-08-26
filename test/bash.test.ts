import assert from "node:assert/strict";
import { after, test } from "node:test";
import { __resetBashShellForTests, bashTool } from "../src/tools/bash.js";

after(() => __resetBashShellForTests());

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

test("cd persists across calls with the same cwd argument", async () => {
  const first = await bashTool.execute({ command: "cd /tmp" }, process.cwd());
  assert.ok(!first.isError);
  const second = await bashTool.execute({ command: "pwd" }, process.cwd());
  assert.match(second.content.trim(), /\/tmp$/);
});

test("exported env vars persist across calls with the same cwd argument", async () => {
  await bashTool.execute({ command: "export MINI_TEST_VAR=hello" }, process.cwd());
  const result = await bashTool.execute({ command: "echo $MINI_TEST_VAR" }, process.cwd());
  assert.equal(result.content.trim(), "hello");
});

test("a timed-out command resets the shell, but a later call still works", async () => {
  const timedOut = await bashTool.execute({ command: "sleep 5", timeout: 100 }, process.cwd());
  assert.equal(timedOut.isError, true);
  assert.match(timedOut.content, /shell session reset/);
  const retry = await bashTool.execute({ command: "echo back" }, process.cwd());
  assert.ok(!retry.isError);
  assert.match(retry.content, /back/);
});

test("spawn failure (e.g. a nonexistent working directory) is reported as an error", async () => {
  const result = await bashTool.execute({ command: "echo hi" }, "/no/such/directory/at/all");
  assert.equal(result.isError, true);
  assert.match(result.content, /Failed to start command/);
});

test("refuses a tripwire command without ever spawning it", async () => {
  const result = await bashTool.execute({ command: "rm -rf /" }, process.cwd());
  assert.equal(result.isError, true);
  assert.match(result.content, /Refused/);
});

test("an already-aborted signal rejects without spawning the command", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    bashTool.execute({ command: "echo hi" }, process.cwd(), controller.signal),
    (err: Error) => err.name === "AbortError",
  );
});

test("aborting mid-command rejects and resets the shell for later calls", async () => {
  const controller = new AbortController();
  const run = bashTool.execute({ command: "sleep 5" }, process.cwd(), controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(run, (err: Error) => err.name === "AbortError");
  const retry = await bashTool.execute({ command: "echo back" }, process.cwd());
  assert.ok(!retry.isError);
  assert.match(retry.content, /back/);
});
