import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool, Message } from "../src/agent/types.js";
import { toOpenAiMessages, toOpenAiTools } from "../src/llm/openrouter.js";

test("toOpenAiMessages: passes through system and user messages", () => {
  const messages: Message[] = [
    { role: "system", content: "be helpful" },
    { role: "user", content: "hi" },
  ];
  assert.deepEqual(toOpenAiMessages(messages), [
    { role: "system", content: "be helpful" },
    { role: "user", content: "hi" },
  ]);
});

test("toOpenAiMessages: assistant text-only content has no tool_calls field", () => {
  const messages: Message[] = [{ role: "assistant", content: [{ type: "text", text: "hello" }] }];
  assert.deepEqual(toOpenAiMessages(messages), [{ role: "assistant", content: "hello" }]);
});

test("toOpenAiMessages: assistant tool calls are serialized with JSON-stringified arguments", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "ls", args: { path: "." } }],
    },
  ];
  assert.deepEqual(toOpenAiMessages(messages), [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "ls", arguments: '{"path":"."}' } }],
    },
  ]);
});

test("toOpenAiMessages: assistant content can mix text and a tool call", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "let me check" },
        { type: "toolCall", id: "call_1", name: "ls", args: {} },
      ],
    },
  ];
  const [out] = toOpenAiMessages(messages) as any[];
  assert.equal(out.content, "let me check");
  assert.equal(out.tool_calls.length, 1);
});

test("toOpenAiMessages: toolResult maps to a 'tool' role message keyed by toolCallId", () => {
  const messages: Message[] = [
    { role: "toolResult", toolCallId: "call_1", toolName: "ls", content: "a.txt", isError: false },
  ];
  assert.deepEqual(toOpenAiMessages(messages), [{ role: "tool", tool_call_id: "call_1", content: "a.txt" }]);
});

test("toOpenAiTools: converts AgentTool[] to OpenAI function-calling schema", () => {
  const tools: AgentTool[] = [
    {
      name: "ls",
      description: "list files",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "" }),
    },
  ];
  assert.deepEqual(toOpenAiTools(tools), [
    {
      type: "function",
      function: { name: "ls", description: "list files", parameters: { type: "object", properties: {} } },
    },
  ]);
});
