import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { Message } from "../src/agent/types.js";
import { streamChatCompletion } from "../src/llm/openrouter.js";

const realFetch = globalThis.fetch;

interface MockCall {
  url: string;
  init: RequestInit;
}

let lastCall: MockCall | undefined;

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function mockFetchOnce(response: Response): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    lastCall = { url: String(url), init };
    return response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  lastCall = undefined;
});

after(() => {
  globalThis.fetch = realFetch;
});

const baseOptions = {
  apiKey: "sk-test",
  model: "vendor/model",
  tools: [],
};

test("streams text deltas and ends with a 'done' event carrying finish_reason", async () => {
  mockFetchOnce(
    new Response(
      sseStream([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      { status: 200 },
    ),
  );

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events = [];
  for await (const event of streamChatCompletion({ ...baseOptions, messages })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text_delta", text: "Hel" },
    { type: "text_delta", text: "lo" },
    { type: "done", finishReason: "stop" },
  ]);
});

test("accumulates streamed tool-call deltas into a tool_call event", async () => {
  mockFetchOnce(
    new Response(
      sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"ls","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\".\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      { status: 200 },
    ),
  );

  const messages: Message[] = [{ role: "user", content: "list files" }];
  const events = [];
  for await (const event of streamChatCompletion({ ...baseOptions, messages })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "tool_call", id: "call_1", name: "ls", args: { path: "." }, malformed: false },
    { type: "done", finishReason: "tool_calls" },
  ]);
});

test("yields a usage event when the stream reports token usage", async () => {
  mockFetchOnce(
    new Response(
      sseStream([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ]),
      { status: 200 },
    ),
  );

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events = [];
  for await (const event of streamChatCompletion({ ...baseOptions, messages })) {
    events.push(event);
  }

  assert.deepEqual(
    events.find((e) => e.type === "usage"),
    {
      type: "usage",
      promptTokens: 10,
      completionTokens: 5,
    },
  );
});

test("a tool call truncated by finish_reason 'length' is marked malformed", async () => {
  mockFetchOnce(
    new Response(
      sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write","arguments":"{\\"path\\":\\"x\\",\\"content\\":\\"unterm"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      { status: 200 },
    ),
  );

  const messages: Message[] = [{ role: "user", content: "write a file" }];
  const events = [];
  for await (const event of streamChatCompletion({ ...baseOptions, messages })) {
    events.push(event);
  }

  const toolCall = events.find((e) => e.type === "tool_call") as any;
  assert.equal(toolCall.malformed, true);
});

test("throws with status and body text when the response is not ok", async () => {
  mockFetchOnce(new Response("bad request details", { status: 400 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  await assert.rejects(async () => {
    for await (const _ of streamChatCompletion({ ...baseOptions, messages })) {
      // drain
    }
  }, /OpenRouter request failed \(400\): bad request details/);
});

test("sends the model, messages, and Authorization header to OpenRouter", async () => {
  mockFetchOnce(new Response(sseStream(["data: [DONE]\n\n"]), { status: 200 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  for await (const _ of streamChatCompletion({ ...baseOptions, apiKey: "sk-secret", messages })) {
    // drain
  }

  assert.ok(lastCall);
  assert.equal(lastCall.url, "https://openrouter.ai/api/v1/chat/completions");
  const headers = lastCall.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-secret");
  const body = JSON.parse(lastCall.init.body as string);
  assert.equal(body.model, "vendor/model");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal(body.stream, true);
});

test("adds top-level cache_control for anthropic models", async () => {
  mockFetchOnce(new Response(sseStream(["data: [DONE]\n\n"]), { status: 200 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  for await (const _ of streamChatCompletion({
    ...baseOptions,
    model: "anthropic/claude-sonnet-4",
    messages,
  })) {
    // drain
  }

  const body = JSON.parse((lastCall?.init.body as string) ?? "{}");
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
});

test("omits cache_control for non-anthropic models", async () => {
  mockFetchOnce(new Response(sseStream(["data: [DONE]\n\n"]), { status: 200 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  for await (const _ of streamChatCompletion({ ...baseOptions, model: "openai/gpt-5", messages })) {
    // drain
  }

  const body = JSON.parse((lastCall?.init.body as string) ?? "{}");
  assert.equal("cache_control" in body, false);
});

test("sends reasoning.effort when set, regardless of model", async () => {
  mockFetchOnce(new Response(sseStream(["data: [DONE]\n\n"]), { status: 200 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  for await (const _ of streamChatCompletion({ ...baseOptions, effort: "high", messages })) {
    // drain
  }

  const body = JSON.parse((lastCall?.init.body as string) ?? "{}");
  assert.deepEqual(body.reasoning, { effort: "high" });
});

test("omits the reasoning field when no effort is set", async () => {
  mockFetchOnce(new Response(sseStream(["data: [DONE]\n\n"]), { status: 200 }));

  const messages: Message[] = [{ role: "user", content: "hi" }];
  for await (const _ of streamChatCompletion({ ...baseOptions, messages })) {
    // drain
  }

  const body = JSON.parse((lastCall?.init.body as string) ?? "{}");
  assert.equal("reasoning" in body, false);
});
