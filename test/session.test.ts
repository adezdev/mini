import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

test("listSessions returns an empty array when no sessions directory exists", async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), "mini-session-empty-"));
  try {
    const sessions = await listSessions(emptyDir);
    assert.deepEqual(sessions, []);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});
