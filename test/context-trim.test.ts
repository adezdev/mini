import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../src/agent/types.js";
import { trimStaleToolOutput } from "../src/context-trim.js";

function userTurn(text: string, toolResultContent: string): Message[] {
  return [
    { role: "user", content: text },
    { role: "assistant", content: [{ type: "toolCall", id: "1", name: "read", args: {} }] },
    { role: "toolResult", toolCallId: "1", toolName: "read", content: toolResultContent, isError: false },
  ];
}

const BIG = "x".repeat(3000);
const SMALL = "y".repeat(100);

test("keeps the current turn's tool output verbatim regardless of size", () => {
  const messages = [{ role: "system", content: "sys" } as Message, ...userTurn("do thing", BIG)];
  trimStaleToolOutput(messages);
  const result = messages.find((m) => m.role === "toolResult");
  assert.equal(result?.content, BIG);
});

test("only trims turns older than the kept window, not recent ones", () => {
  const messages: Message[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 5; i++) messages.push(...userTurn(`turn ${i}`, BIG));

  trimStaleToolOutput(messages);

  const results = messages.filter((m) => m.role === "toolResult");
  // turn 4 is current (0 turns ago); turns 3 and 2 are within the kept
  // window (1 and 2 turns ago); turns 1 and 0 are old enough to trim.
  assert.equal(results[4]?.content, BIG);
  assert.equal(results[2]?.content, BIG);
  assert.match(results[1]?.content ?? "", /^\[trimmed:/);
  assert.match(results[0]?.content ?? "", /^\[trimmed:/);
});

test("leaves small tool output alone even when old", () => {
  const messages: Message[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 5; i++) messages.push(...userTurn(`turn ${i}`, SMALL));

  trimStaleToolOutput(messages);

  const results = messages.filter((m) => m.role === "toolResult");
  assert.equal(results[0]?.content, SMALL);
});

test("is idempotent — doesn't re-trim an already-trimmed message", () => {
  const messages: Message[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 6; i++) messages.push(...userTurn(`turn ${i}`, BIG));

  trimStaleToolOutput(messages);
  const results = messages.filter((m) => m.role === "toolResult");
  const trimmedOnce = results[0]?.content;
  assert.match(trimmedOnce ?? "", /^\[trimmed:/);

  trimStaleToolOutput(messages);
  assert.equal(results[0]?.content, trimmedOnce);
});

test("MINI_CONTEXT_TRIM=0 disables trimming", () => {
  const prev = process.env.MINI_CONTEXT_TRIM;
  process.env.MINI_CONTEXT_TRIM = "0";
  try {
    const messages: Message[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 6; i++) messages.push(...userTurn(`turn ${i}`, BIG));
    trimStaleToolOutput(messages);
    const results = messages.filter((m) => m.role === "toolResult");
    assert.equal(results[0]?.content, BIG);
  } finally {
    if (prev === undefined) delete process.env.MINI_CONTEXT_TRIM;
    else process.env.MINI_CONTEXT_TRIM = prev;
  }
});
