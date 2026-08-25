import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { Config } from "../src/config.js";
import { computeRefinement, extractJsonArray, proposeRefinements } from "../src/refine.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function mockResponse(text: string): void {
  globalThis.fetch = (async () => new Response(sseStream(text), { status: 200 })) as unknown as typeof fetch;
}

const config: Config = { apiKey: "sk-test", model: "vendor/model", cwd: "/tmp", maxTurns: 5 };

test("extractJsonArray reads a bare JSON array", () => {
  assert.deepEqual(extractJsonArray('[{"oldText":"a","newText":"b"}]'), [{ oldText: "a", newText: "b" }]);
});

test("extractJsonArray strips prose and markdown fences around the array", () => {
  const text = 'Here are the edits:\n```json\n[{"oldText":"a","newText":"b"}]\n```\nLet me know.';
  assert.deepEqual(extractJsonArray(text), [{ oldText: "a", newText: "b" }]);
});

test("extractJsonArray throws when no array is present", () => {
  assert.throws(() => extractJsonArray("no json here"), /no JSON array/);
});

test("proposeRefinements returns an empty array when the model finds nothing to add", async () => {
  mockResponse("[]");
  const edits = await proposeRefinements(config, [], "# CLAUDE.md\n");
  assert.deepEqual(edits, []);
});

test("proposeRefinements parses proposed edits from the model response", async () => {
  mockResponse('[{"oldText":"# CLAUDE.md\\n","newText":"# CLAUDE.md\\n\\nNew note.\\n"}]');
  const edits = await proposeRefinements(config, [], "# CLAUDE.md\n");
  assert.deepEqual(edits, [{ oldText: "# CLAUDE.md\n", newText: "# CLAUDE.md\n\nNew note.\n" }]);
});

test("proposeRefinements rejects a malformed edit shape", async () => {
  mockResponse('[{"oldText":"a"}]');
  await assert.rejects(proposeRefinements(config, [], "content"), /malformed edit/);
});

test("computeRefinement returns null when there's nothing to refine", async () => {
  mockResponse("[]");
  const result = await computeRefinement(config, [], "# CLAUDE.md\n");
  assert.equal(result, null);
});

test("computeRefinement applies edits in memory and returns a diff, without touching disk", async () => {
  mockResponse('[{"oldText":"one\\n","newText":"one\\ntwo\\n"}]');
  const result = await computeRefinement(config, [], "one\n");
  assert.ok(result);
  assert.equal(result?.newContent, "one\ntwo\n");
  assert.match(result?.diff ?? "", /\+two/);
});

test("computeRefinement throws when a proposed oldText doesn't match the file", async () => {
  mockResponse('[{"oldText":"missing","newText":"x"}]');
  await assert.rejects(computeRefinement(config, [], "actual content"), /oldText not found/);
});
