// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { AgentTool, Message } from "../agent/types.js";
import { parseSSEStream } from "./sse.js";
import { ToolCallAccumulator, type ToolCallDelta } from "./tool-call-accumulator.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown; malformed: boolean }
  | { type: "usage"; promptTokens: number; completionTokens: number }
  | { type: "done"; finishReason: string | null };

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function toOpenAiMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "system":
        out.push({ role: "system", content: m.content });
        break;
      case "user":
        out.push({ role: "user", content: m.content });
        break;
      case "assistant": {
        const text = m.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        const toolCalls = m.content
          .filter((c) => c.type === "toolCall")
          .map((c) => {
            const tc = c as Extract<typeof c, { type: "toolCall" }>;
            return {
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
            };
          });
        out.push({
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        break;
      }
      case "toolResult":
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
        break;
    }
  }
  return out;
}

export function toOpenAiTools(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export interface StreamChatCompletionOptions {
  apiKey: string;
  model: string;
  messages: Message[];
  tools: AgentTool[];
  signal?: AbortSignal;
}

export async function* streamChatCompletion(options: StreamChatCompletionOptions): AsyncGenerator<StreamEvent> {
  const { apiKey, model, messages, tools, signal } = options;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/mini-agent/mini",
      "X-Title": "mini",
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages),
      ...(tools.length > 0 ? { tools: toOpenAiTools(tools) } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${response.status}): ${bodyText.slice(0, 2000)}`);
  }

  const accumulator = new ToolCallAccumulator();
  let finishReason: string | null = null;

  for await (const chunk of parseSSEStream(response.body)) {
    const c = chunk as ChatCompletionChunk;

    if (c.usage) {
      yield {
        type: "usage",
        promptTokens: c.usage.prompt_tokens ?? 0,
        completionTokens: c.usage.completion_tokens ?? 0,
      };
    }

    const choice = c.choices?.[0];
    if (!choice) continue;

    if (choice.delta?.content) {
      yield { type: "text_delta", text: choice.delta.content };
    }
    if (choice.delta?.tool_calls) {
      for (const delta of choice.delta.tool_calls) {
        accumulator.addDelta(delta);
      }
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  if (!accumulator.isEmpty()) {
    for (const call of accumulator.finalize()) {
      yield {
        type: "tool_call",
        id: call.id,
        name: call.name,
        args: call.args,
        malformed: call.malformed || finishReason === "length",
      };
    }
  }

  yield { type: "done", finishReason };
}
