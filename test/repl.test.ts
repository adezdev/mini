import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { after, afterEach, before, test } from "node:test";
import type { Config } from "../src/config.js";
import { __resetModelPricingCacheForTests, runOneShot, runReplLoop } from "../src/repl.js";
import { Session } from "../src/session/jsonl.js";

const realFetch = globalThis.fetch;

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function textReplySse(text: string): ReadableStream<Uint8Array> {
  return sseStream([
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ]);
}

const modelsBody = {
  data: [
    {
      id: "vendor/free-model:free",
      name: "Free Model",
      context_length: 262_144,
      supported_parameters: ["tools"],
      pricing: { prompt: "0", completion: "0" },
    },
  ],
};

function mockFetch(): void {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/models")) {
      return Response.json(modelsBody);
    }
    return new Response(textReplySse("ok"), { status: 200 });
  }) as unknown as typeof fetch;
}

function toolCallSse(id: string, name: string, args: unknown): ReadableStream<Uint8Array> {
  return sseStream([
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":${JSON.stringify(id)},"function":{"name":${JSON.stringify(name)},"arguments":${JSON.stringify(JSON.stringify(args))}}}]}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ]);
}

function textSseWithUsage(text: string, promptTokens: number, completionTokens: number): ReadableStream<Uint8Array> {
  return sseStream([
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`,
    `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":${promptTokens},"completion_tokens":${completionTokens}}}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

/** Mocks the chat-completions endpoint with a fixed sequence of responses (one per call), and the models endpoint with modelsBody. */
function mockChatSequence(streams: ReadableStream<Uint8Array>[]): void {
  let call = 0;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/models")) {
      return Response.json(modelsBody);
    }
    const stream = streams[Math.min(call, streams.length - 1)];
    call++;
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

after(() => {
  globalThis.fetch = realFetch;
});

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-repl-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function testConfig(overrides: Partial<Config> = {}): Config {
  return { apiKey: "sk-test", model: "vendor/free-model:free", cwd: dir, maxTurns: 30, ...overrides };
}

test("runOneShot persists the user prompt and assistant reply to the session", async () => {
  mockFetch();
  const session = await Session.create(dir);
  await runOneShot(testConfig(), "hello there", session);

  const { messages } = await Session.resume(dir, session.id);
  assert.equal(messages[0].role, "system");
  assert.deepEqual(messages[1], { role: "user", content: "hello there" });
  assert.equal(messages[2].role, "assistant");
});

/**
 * Drives runReplLoop with an in-memory input stream, feeding the next queued
 * line the moment the "> " prompt is written (not on a timer), so
 * sequencing is exact regardless of system load. Bun's console.log/error
 * bypass process.stdout.write internally, so both are intercepted directly
 * to capture everything the REPL prints.
 */
async function runRepl(config: Config, session: Session, messages: any[], inputs: string[]): Promise<string> {
  let output = "";
  let idx = 0;
  let ended = false;
  const input = new Readable({ read() {} });

  const realWrite = process.stdout.write.bind(process.stdout);
  const realLog = console.log;
  const realError = console.error;

  const capture = (text: string): void => {
    output += text;
    if (text === "> " || text === "model> ") {
      if (idx < inputs.length) {
        input.push(`${inputs[idx++]}\n`);
      } else if (!ended) {
        ended = true;
        input.push(null);
      }
    }
  };

  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    capture(String(chunk));
    return true;
  };
  console.log = (...args: unknown[]) => capture(`${args.join(" ")}\n`);
  console.error = (...args: unknown[]) => capture(`${args.join(" ")}\n`);

  try {
    const rl = createInterface({ input, output: process.stdout, terminal: false });
    await runReplLoop(config, messages, session, rl);
  } finally {
    process.stdout.write = realWrite;
    console.log = realLog;
    console.error = realError;
  }
  return output;
}

test("runReplLoop: /help lists commands", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(testConfig(), session, [{ role: "system", content: "sys" }], ["/help", "/exit"]);
  assert.match(output, /\/compact\s+Summarize/);
});

test("runReplLoop: /tools lists the built-in tools", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(testConfig(), session, [{ role: "system", content: "sys" }], ["/tools", "/exit"]);
  assert.match(output, /ls: List files/);
});

test("runReplLoop: /system prints the current system prompt", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(
    testConfig(),
    session,
    [{ role: "system", content: "be a helpful robot" }],
    ["/system", "/exit"],
  );
  assert.match(output, /be a helpful robot/);
});

test("runReplLoop: /clear resets messages back to a single system message", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const messages: any[] = [
    { role: "system", content: "old prompt" },
    { role: "user", content: "leftover" },
  ];
  await runRepl(testConfig(), session, messages, ["/clear", "/exit"]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "system");
});

test("runReplLoop: /sessions lists saved sessions and marks the current one", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(testConfig(), session, [{ role: "system", content: "sys" }], ["/sessions", "/exit"]);
  assert.match(output, new RegExp(`${session.id}.*\\*`));
});

test("runReplLoop: /model <id> switches the model without a network call", async () => {
  const session = await Session.create(dir);
  const config = testConfig();
  globalThis.fetch = (async () => {
    throw new Error("should not fetch for a direct model id");
  }) as unknown as typeof fetch;
  const output = await runRepl(
    config,
    session,
    [{ role: "system", content: "sys" }],
    ["/model vendor/other-model", "/exit"],
  );
  assert.equal(config.model, "vendor/other-model");
  assert.match(output, /Model set to vendor\/other-model/);
});

test("runReplLoop: a plain message runs a turn and streams the reply", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi there", "/exit"]);
  assert.match(output, /ok/);
  assert.ok(messages.some((m) => m.role === "user" && m.content === "hi there"));
});

test("runReplLoop: /resume switches to another session's messages", async () => {
  mockFetch();
  const other = await Session.create(dir);
  await other.appendMessage({ role: "system", content: "other-system" });
  await other.appendMessage({ role: "user", content: "other-user-message" });

  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  await runRepl(testConfig(), session, messages, [`/resume ${other.id}`, "/exit"]);

  assert.ok(messages.some((m) => m.role === "user" && m.content === "other-user-message"));
});

test("runReplLoop: /resume with an unknown session id prints an error instead of throwing", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(
    testConfig(),
    session,
    [{ role: "system", content: "sys" }],
    ["/resume no-such-session", "/exit"],
  );
  assert.match(output, /Could not resume session no-such-session/);
});

test("runReplLoop: a turn with a tool call prints the tool header and result, then the reply", async () => {
  mockChatSequence([toolCallSse("call_1", "ls", { path: "." }), textSseWithUsage("done", 1, 1)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["list files", "/exit"]);

  assert.match(output, /› ls\(/);
  assert.match(output, /done/);
  assert.ok(messages.some((m) => m.role === "toolResult" && m.toolName === "ls"));
});

test("runReplLoop: /cost reports cumulative usage and estimated cost after a turn", async () => {
  mockChatSequence([textSseWithUsage("ok", 100, 50)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "/cost", "/exit"]);

  assert.match(output, /Session usage: 100 prompt \+ 50 completion = 150 tokens/);
  assert.match(output, /Estimated cost for vendor\/free-model:free: \$0\.0000/);
});

test("runReplLoop: /cost before any turn reports zero usage", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const output = await runRepl(testConfig(), session, [{ role: "system", content: "sys" }], ["/cost", "/exit"]);
  assert.match(output, /Session usage: 0 prompt \+ 0 completion = 0 tokens/);
});

test("runReplLoop: /compact replaces history with a system message plus a summary", async () => {
  mockChatSequence([textReplySse("hi"), textSseWithUsage("Summary of the chat.", 5, 5)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "/compact", "/exit"]);

  assert.match(output, /History compacted \(context now 2 messages\)/);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /Summary of the chat\./);
});

test("runReplLoop: /model with no id fetches and picks by number", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const config = testConfig({ model: "vendor/other" });
  const output = await runRepl(config, session, [{ role: "system", content: "sys" }], ["/model", "1", "/exit"]);

  assert.equal(config.model, "vendor/free-model:free");
  assert.match(output, /Model set to vendor\/free-model:free/);
});

test("runReplLoop: /model typing an id directly at the picker prompt sets it verbatim", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const config = testConfig();
  const output = await runRepl(
    config,
    session,
    [{ role: "system", content: "sys" }],
    ["/model", "vendor/typed-directly", "/exit"],
  );
  assert.equal(config.model, "vendor/typed-directly");
  assert.match(output, /Model set to vendor\/typed-directly/);
});

test("runReplLoop: /model cancels on a blank answer, leaving the model unchanged", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const config = testConfig({ model: "vendor/unchanged" });
  await runRepl(config, session, [{ role: "system", content: "sys" }], ["/model", "", "/exit"]);
  assert.equal(config.model, "vendor/unchanged");
});

test("runReplLoop: /model reports an error instead of throwing when the model list fetch fails", async () => {
  globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  const session = await Session.create(dir);
  const output = await runRepl(testConfig(), session, [{ role: "system", content: "sys" }], ["/model", "/exit"]);
  assert.match(output, /Could not fetch model list/);
});

test("runReplLoop: /cost still reports token totals when the pricing fetch fails", async () => {
  __resetModelPricingCacheForTests();
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/models")) return new Response("", { status: 503 });
    return new Response(textSseWithUsage("ok", 7, 3), { status: 200 });
  }) as unknown as typeof fetch;

  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "/cost", "/exit"]);

  assert.match(output, /Session usage: 7 prompt \+ 3 completion = 10 tokens/);
  assert.match(output, /pricing unavailable/);
});
