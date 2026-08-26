import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { type LoopEvent, runAgentLoop } from "../src/agent/loop.js";
import type { AgentTool, Message } from "../src/agent/types.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function toolCallSse(id: string, name: string, args: unknown): ReadableStream<Uint8Array> {
  return sseStream([
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":${JSON.stringify(id)},"function":{"name":${JSON.stringify(name)},"arguments":${JSON.stringify(JSON.stringify(args))}}}]}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ]);
}

function textSse(text: string): ReadableStream<Uint8Array> {
  return sseStream([
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ]);
}

function emptySse(): ReadableStream<Uint8Array> {
  return sseStream(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', "data: [DONE]\n\n"]);
}

function mockFetchSequence(streams: ReadableStream<Uint8Array>[]): void {
  let call = 0;
  globalThis.fetch = (async () => {
    const stream = streams[Math.min(call, streams.length - 1)];
    call++;
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

function baseOptions(messages: Message[], tools: AgentTool[], events: LoopEvent[]) {
  return {
    apiKey: "sk-test",
    model: "vendor/model",
    messages,
    tools,
    onEvent: (e: LoopEvent) => events.push(e),
  };
}

test("executes a tool call, feeds the result back, and stops on the next plain-text reply", async () => {
  mockFetchSequence([toolCallSse("call_1", "echo", { text: "hi" }), textSse("done")]);

  const echoTool: AgentTool = {
    name: "echo",
    description: "echoes",
    parameters: { type: "object", properties: {} },
    execute: async (args: { text: string }) => ({ content: `echo: ${args.text}` }),
  };

  const messages: Message[] = [{ role: "user", content: "say hi" }];
  const events: LoopEvent[] = [];
  await runAgentLoop(baseOptions(messages, [echoTool], events));

  assert.deepEqual(
    events.map((e) => e.type),
    ["tool_call_start", "tool_call_end", "text_delta", "turn_end"],
  );
  const toolEnd = events.find((e) => e.type === "tool_call_end") as any;
  assert.equal(toolEnd.content, "echo: hi");
  assert.equal(toolEnd.isError, false);

  const toolResultMessage = messages.find((m) => m.role === "toolResult") as any;
  assert.equal(toolResultMessage.content, "echo: hi");
  const finalAssistant = messages[messages.length - 1] as any;
  assert.deepEqual(finalAssistant.content, [{ type: "text", text: "done" }]);
});

test("a truly empty reply (no text, no tool call) surfaces a notice instead of ending silently", async () => {
  mockFetchSequence([emptySse()]);

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events: LoopEvent[] = [];
  await runAgentLoop(baseOptions(messages, [], events));

  assert.deepEqual(
    events.map((e) => e.type),
    ["text_delta", "turn_end"],
  );
  const notice = events[0] as any;
  assert.match(notice.text, /empty response/);

  const finalAssistant = messages[messages.length - 1] as any;
  assert.deepEqual(finalAssistant.content, []);
});

test("an unknown tool name produces an error toolResult without throwing", async () => {
  mockFetchSequence([toolCallSse("call_1", "does-not-exist", {}), textSse("ok")]);

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events: LoopEvent[] = [];
  await runAgentLoop(baseOptions(messages, [], events));

  const toolEnd = events.find((e) => e.type === "tool_call_end") as any;
  assert.equal(toolEnd.isError, true);
  assert.equal(toolEnd.content, "Unknown tool: does-not-exist");
});

test("a tool that throws is caught and reported as an error toolResult", async () => {
  mockFetchSequence([toolCallSse("call_1", "boom", {}), textSse("ok")]);

  const boomTool: AgentTool = {
    name: "boom",
    description: "throws",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      throw new Error("kaboom");
    },
  };

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events: LoopEvent[] = [];
  await runAgentLoop(baseOptions(messages, [boomTool], events));

  const toolEnd = events.find((e) => e.type === "tool_call_end") as any;
  assert.equal(toolEnd.isError, true);
  assert.match(toolEnd.content, /Tool threw an error: kaboom/);
});

test("a tool aborted mid-call propagates instead of becoming a toolResult", async () => {
  mockFetchSequence([toolCallSse("call_1", "slow", {})]);

  const slowTool: AgentTool = {
    name: "slow",
    description: "honors the abort signal",
    parameters: { type: "object", properties: {} },
    execute: async (_args: unknown, _cwd: string, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return { content: "should not get here" };
    },
  };

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events: LoopEvent[] = [];
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runAgentLoop({ ...baseOptions(messages, [slowTool], events), signal: controller.signal }),
    (err: Error) => err.name === "AbortError",
  );
  assert.ok(!events.some((e) => e.type === "tool_call_end"));
});

test("passes the loop's signal through to tool.execute", async () => {
  mockFetchSequence([toolCallSse("call_1", "echo", {}), textSse("done")]);

  let receivedSignal: AbortSignal | undefined;
  const echoTool: AgentTool = {
    name: "echo",
    description: "echoes",
    parameters: { type: "object", properties: {} },
    execute: async (_args: unknown, _cwd: string, signal?: AbortSignal) => {
      receivedSignal = signal;
      return { content: "ok" };
    },
  };

  const messages: Message[] = [{ role: "user", content: "hi" }];
  const events: LoopEvent[] = [];
  const controller = new AbortController();
  await runAgentLoop({ ...baseOptions(messages, [echoTool], events), signal: controller.signal });

  assert.equal(receivedSignal, controller.signal);
});

test("stops after MAX_TURNS (30) and reports it via a final text_delta", async () => {
  const alwaysTool: AgentTool = {
    name: "loopy",
    description: "always called",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "again" }),
  };

  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    return new Response(toolCallSse(`call_${call}`, "loopy", {}), { status: 200 });
  }) as unknown as typeof fetch;

  const messages: Message[] = [{ role: "user", content: "go forever" }];
  const events: LoopEvent[] = [];
  await runAgentLoop(baseOptions(messages, [alwaysTool], events));

  assert.equal(call, 30);
  const last = events[events.length - 1];
  assert.equal(last.type, "turn_end");
  const cappedNotice = events.find((e) => e.type === "text_delta" && /Reached max turns \(30\)/.test(e.text));
  assert.ok(cappedNotice);
});

test("a custom maxTurns overrides the default cap", async () => {
  const alwaysTool: AgentTool = {
    name: "loopy",
    description: "always called",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "again" }),
  };

  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    return new Response(toolCallSse(`call_${call}`, "loopy", {}), { status: 200 });
  }) as unknown as typeof fetch;

  const messages: Message[] = [{ role: "user", content: "go forever" }];
  const events: LoopEvent[] = [];
  await runAgentLoop({ ...baseOptions(messages, [alwaysTool], events), maxTurns: 3 });

  assert.equal(call, 3);
  const cappedNotice = events.find((e) => e.type === "text_delta" && /Reached max turns \(3\)/.test(e.text));
  assert.ok(cappedNotice);
});
