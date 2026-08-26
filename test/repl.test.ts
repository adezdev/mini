import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    if (text === "> " || text === "model> " || text.endsWith("] ")) {
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

/** A stream that errors as soon as its signal aborts, standing in for fetch cancelling mid-request. */
function abortableSse(signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const fail = () =>
        controller.error(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      if (signal?.aborted) {
        fail();
        return;
      }
      signal?.addEventListener("abort", fail);
    },
  });
}

test("runReplLoop: Ctrl+C during a turn cancels it instead of killing the process", async () => {
  globalThis.fetch = (async (url: string, init?: { signal?: AbortSignal }) => {
    if (String(url).includes("/models")) return Response.json(modelsBody);
    process.emit("SIGINT"); // simulates the user hitting Ctrl+C while this "request" is in flight
    return new Response(abortableSse(init?.signal), { status: 200 });
  }) as unknown as typeof fetch;

  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi there", "still alive?", "/exit"]);

  assert.match(output, /Interrupted/);
  // the REPL loop kept running afterward instead of the process dying
  assert.ok(messages.some((m) => m.role === "user" && m.content === "still alive?"));
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

test("runReplLoop: checkpoints a tool call that changes files, on a git repo", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-repl-checkpoint-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["config", "commit.gpgsign", "false"]);
    await writeFile(join(repo, "README.md"), "hello");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "initial"]);

    mockChatSequence([
      toolCallSse("call_1", "write", { path: "new.txt", content: "hi" }),
      textSseWithUsage("done", 1, 1),
    ]);
    const session = await Session.create(repo);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig({ cwd: repo }), session, messages, ["write a file", "/exit"]);

    assert.match(output, /Checkpointing enabled — created and switched to mini\//);
    assert.match(output, /Checkpointing: 1 commit\(s\) on mini\//);
    assert.match(git(["log", "-1", "--format=%s"]), /mini checkpoint: write a file/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runReplLoop: checkpointing activates mid-session once the model runs git init itself", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-repl-checkpoint-lazy-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });

    mockChatSequence([
      toolCallSse("call_1", "bash", {
        command:
          "git init -q -b main && git config user.email t@t.com && git config user.name T && git config commit.gpgsign false",
      }),
      toolCallSse("call_2", "write", { path: "README.md", content: "hello" }),
      textSseWithUsage("done", 1, 1),
    ]);
    const session = await Session.create(repo);
    const messages: any[] = [{ role: "system", content: "sys" }];
    // Not a git repo when the session starts, so initCheckpointing disables up front; it only
    // activates because maybeActivateCheckpointing retries after the turn's own git init.
    const output = await runRepl(testConfig({ cwd: repo }), session, messages, ["set up a project", "/exit"]);

    assert.match(output, /Checkpointing enabled/);
    assert.match(git(["log", "-1", "--format=%s"]), /mini checkpoint: set up a project/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runReplLoop: no checkpointing notices in a non-git working directory", async () => {
  mockChatSequence([toolCallSse("call_1", "ls", { path: "." }), textSseWithUsage("done", 1, 1)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["list files", "/exit"]);

  assert.ok(!output.includes("Checkpointing"));
});

test("runReplLoop: a mutating tool call triggers an automatic self-check pass", async () => {
  mockChatSequence([
    toolCallSse("call_1", "write", { path: "x.txt", content: "hi" }),
    textSseWithUsage("first pass done", 1, 1),
    textSseWithUsage("self-check pass done", 1, 1),
  ]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["write a file", "/exit"]);

  assert.match(output, /auto self-check: verifying the changes above/);
  assert.match(output, /first pass done/);
  assert.match(output, /self-check pass done/);
  assert.ok(messages.some((m) => m.role === "user" && String(m.content).includes("[auto self-check]")));
});

test("runReplLoop: a read-only tool call does not trigger a self-check pass", async () => {
  mockChatSequence([toolCallSse("call_1", "ls", { path: "." }), textSseWithUsage("done", 1, 1)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["list files", "/exit"]);

  assert.ok(!output.includes("auto self-check"));
});

test("runReplLoop: MINI_SELF_CHECK=0 disables the automatic self-check pass", async () => {
  process.env.MINI_SELF_CHECK = "0";
  try {
    mockChatSequence([
      toolCallSse("call_1", "write", { path: "y.txt", content: "hi" }),
      textSseWithUsage("done", 1, 1),
    ]);
    const session = await Session.create(dir);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig(), session, messages, ["write a file", "/exit"]);
    assert.ok(!output.includes("auto self-check"));
  } finally {
    delete process.env.MINI_SELF_CHECK;
  }
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

test("runReplLoop: warns once when a turn's prompt tokens cross the context threshold", async () => {
  mockChatSequence([textSseWithUsage("ok", 210_000, 10), textSseWithUsage("ok again", 220_000, 10)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "hi again", "/exit"]);

  const warnings = output.match(/Context usage at \d+%/g) ?? [];
  assert.equal(warnings.length, 1);
});

test("runReplLoop: no context warning when usage stays well under the threshold", async () => {
  mockChatSequence([textSseWithUsage("ok", 100, 10)]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "/exit"]);

  assert.ok(!output.includes("Context usage"));
});

test("runReplLoop: /compact resets the context warning so it can fire again", async () => {
  mockChatSequence([
    textSseWithUsage("ok", 210_000, 10),
    textSseWithUsage("Summary of the chat.", 5, 5),
    textSseWithUsage("ok", 210_000, 10),
  ]);
  const session = await Session.create(dir);
  const messages: any[] = [{ role: "system", content: "sys" }];
  const output = await runRepl(testConfig(), session, messages, ["hi", "/compact", "hi again", "/exit"]);

  const warnings = output.match(/Context usage at \d+%/g) ?? [];
  assert.equal(warnings.length, 2);
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

test("runReplLoop: /refine proposes CLAUDE.md edits and applies them on confirmation", async () => {
  const refineDir = await mkdtemp(join(tmpdir(), "mini-repl-refine-"));
  try {
    await writeFile(join(refineDir, "CLAUDE.md"), "# Notes\n\nOriginal line.\n");
    mockChatSequence([
      textReplySse("hi"),
      textReplySse('[{"oldText":"Original line.\\n","newText":"Original line.\\nNew line from refine.\\n"}]'),
    ]);
    const session = await Session.create(refineDir);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig({ cwd: refineDir }), session, messages, ["hi", "/refine", "y", "/exit"]);

    assert.match(output, /CLAUDE\.md updated/);
    const updated = await readFile(join(refineDir, "CLAUDE.md"), "utf-8");
    assert.match(updated, /New line from refine\./);
  } finally {
    await rm(refineDir, { recursive: true, force: true });
  }
});

test("runReplLoop: /refine discards proposed edits when not confirmed", async () => {
  const refineDir = await mkdtemp(join(tmpdir(), "mini-repl-refine-"));
  try {
    await writeFile(join(refineDir, "CLAUDE.md"), "# Notes\n\nOriginal line.\n");
    mockChatSequence([
      textReplySse("hi"),
      textReplySse('[{"oldText":"Original line.\\n","newText":"Original line.\\nNew line.\\n"}]'),
    ]);
    const session = await Session.create(refineDir);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig({ cwd: refineDir }), session, messages, ["hi", "/refine", "n", "/exit"]);

    assert.match(output, /Discarded/);
    const unchanged = await readFile(join(refineDir, "CLAUDE.md"), "utf-8");
    assert.equal(unchanged, "# Notes\n\nOriginal line.\n");
  } finally {
    await rm(refineDir, { recursive: true, force: true });
  }
});

test("runReplLoop: /refine reports when there's nothing to add", async () => {
  const refineDir = await mkdtemp(join(tmpdir(), "mini-repl-refine-"));
  try {
    await writeFile(join(refineDir, "CLAUDE.md"), "# Notes\n");
    mockChatSequence([textReplySse("hi"), textReplySse("[]")]);
    const session = await Session.create(refineDir);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig({ cwd: refineDir }), session, messages, ["hi", "/refine", "/exit"]);

    assert.match(output, /Nothing to refine/);
  } finally {
    await rm(refineDir, { recursive: true, force: true });
  }
});

test("runReplLoop: /refine reports when no project instructions file exists", async () => {
  const refineDir = await mkdtemp(join(tmpdir(), "mini-repl-refine-none-"));
  try {
    mockFetch();
    const session = await Session.create(refineDir);
    const messages: any[] = [{ role: "system", content: "sys" }];
    const output = await runRepl(testConfig({ cwd: refineDir }), session, messages, ["/refine", "/exit"]);

    assert.match(output, /No AGENTS\.md\/CLAUDE\.md\/MINI\.md found/);
  } finally {
    await rm(refineDir, { recursive: true, force: true });
  }
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

test("runReplLoop: /model </command> is rejected instead of set as a literal model id", async () => {
  const session = await Session.create(dir);
  const config = testConfig({ model: "vendor/unchanged" });
  const output = await runRepl(config, session, [{ role: "system", content: "sys" }], ["/model /system", "/exit"]);

  assert.equal(config.model, "vendor/unchanged");
  assert.match(output, /doesn't look like a model id/);
});

test("runReplLoop: typing a /command at the picker prompt is rejected, not set as a literal model id", async () => {
  mockFetch();
  const session = await Session.create(dir);
  const config = testConfig({ model: "vendor/unchanged" });
  const output = await runRepl(config, session, [{ role: "system", content: "sys" }], ["/model", "/system", "/exit"]);

  assert.equal(config.model, "vendor/unchanged");
  assert.match(output, /doesn't look like a model id/);
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
