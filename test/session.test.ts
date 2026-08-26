import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "../src/agent/types.js";
import { listSessions, Session } from "../src/session/jsonl.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-session-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("create then resume round-trips appended messages in order", async () => {
  const session = await Session.create(dir);
  const messages: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
  ];
  for (const m of messages) await session.appendMessage(m);

  const resumed = await Session.resume(dir, session.id);
  assert.equal(resumed.session.id, session.id);
  assert.deepEqual(resumed.messages, messages);
});

test("listSessions returns saved sessions newest first", async () => {
  const first = await Session.create(dir);
  await first.appendMessage({ role: "user", content: "one" });
  await new Promise((r) => setTimeout(r, 5));
  const second = await Session.create(dir);
  await second.appendMessage({ role: "user", content: "two" });

  const sessions = await listSessions(dir);
  const ids = sessions.map((s) => s.id);
  assert.ok(ids.includes(first.id));
  assert.ok(ids.includes(second.id));
  assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id));
});

test("Session.create writes a .mini/.gitignore that keeps session state out of git, but carves out tools/", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-session-gitignore-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
    git(["init", "-q", "-b", "main"]);

    await Session.create(repo);

    const gitignore = await readFile(join(repo, ".mini", ".gitignore"), "utf-8");
    assert.equal(gitignore, "*\n!tools/\n!tools/**\n");

    const status = git(["status", "--porcelain"]);
    assert.equal(status.trim(), "");

    git(["add", "-A"]);
    const staged = git(["status", "--porcelain"]);
    assert.equal(staged.trim(), "");

    await mkdir(join(repo, ".mini", "tools"), { recursive: true });
    await writeFile(join(repo, ".mini", "tools", "extra.ts"), "export default {};\n");
    // -uall: a plain `git status` collapses a wholly-new directory into one line
    // ("?? .mini/") regardless of what's ignored inside it — need the per-file listing to
    // actually prove the carve-out unignored this specific file rather than the whole dir.
    const toolStatus = git(["status", "--porcelain", "-uall"]);
    assert.match(toolStatus, /\.mini\/tools\/extra\.ts/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("listSessions returns an empty array when no sessions directory exists", async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), "mini-session-empty-"));
  try {
    const sessions = await listSessions(emptyDir);
    assert.deepEqual(sessions, []);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});
