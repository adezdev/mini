import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSSEStream } from "../src/llm/sse.js";

function streamFrom(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

test("parses complete SSE data lines into JSON payloads", async () => {
  const stream = streamFrom(['data: {"a":1}\n\n', 'data: {"a":2}\n\n', "data: [DONE]\n\n"]);
  const results = [];
  for await (const event of parseSSEStream(stream)) results.push(event);
  assert.deepEqual(results, [{ a: 1 }, { a: 2 }]);
});

test("handles a payload split across multiple stream chunks", async () => {
  const stream = streamFrom(['data: {"a"', ":1}\n\n", "data: [DONE]\n\n"]);
  const results = [];
  for await (const event of parseSSEStream(stream)) results.push(event);
  assert.deepEqual(results, [{ a: 1 }]);
});

test("ignores blank lines and malformed JSON payloads", async () => {
  const stream = streamFrom(["\n", "data: not json\n\n", 'data: {"ok":true}\n\n']);
  const results = [];
  for await (const event of parseSSEStream(stream)) results.push(event);
  assert.deepEqual(results, [{ ok: true }]);
});
