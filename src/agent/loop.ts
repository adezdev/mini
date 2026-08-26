// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { streamChatCompletion } from "../llm/openrouter.js";
import type { AgentTool, AssistantContent, Message, ToolResultMessage } from "./types.js";

const DEFAULT_MAX_TURNS = 30;

export type LoopEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string; args: unknown }
  | { type: "tool_call_end"; id: string; name: string; content: string; isError: boolean }
  | { type: "usage"; promptTokens: number; completionTokens: number }
  | { type: "turn_end" };

export interface RunAgentLoopOptions {
  apiKey: string;
  model: string;
  messages: Message[];
  tools: AgentTool[];
  /** Working directory passed to every tool call. Defaults to process.cwd(). */
  cwd?: string;
  onEvent: (event: LoopEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
}

/**
 * Runs the agent loop to completion: stream a response, execute any tool
 * calls it made, feed results back in, and repeat until a turn produces no
 * tool calls (or the safety cap is hit). Mutates `messages` in place by
 * appending the assistant/tool-result messages produced along the way.
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<void> {
  const {
    apiKey,
    model,
    messages,
    tools,
    onEvent,
    signal,
    maxTurns = DEFAULT_MAX_TURNS,
    cwd = process.cwd(),
  } = options;
  const registry = new Map(tools.map((t) => [t.name, t]));

  for (let turn = 0; turn < maxTurns; turn++) {
    const assistantContent: AssistantContent[] = [];
    let currentText = "";

    for await (const event of streamChatCompletion({ apiKey, model, messages, tools, signal })) {
      switch (event.type) {
        case "text_delta":
          currentText += event.text;
          onEvent({ type: "text_delta", text: event.text });
          break;
        case "tool_call":
          if (currentText) {
            assistantContent.push({ type: "text", text: currentText });
            currentText = "";
          }
          assistantContent.push({ type: "toolCall", id: event.id, name: event.name, args: event.args });
          break;
        case "usage":
          onEvent({ type: "usage", promptTokens: event.promptTokens, completionTokens: event.completionTokens });
          break;
        case "done":
          break;
      }
    }
    if (currentText) {
      assistantContent.push({ type: "text", text: currentText });
    }

    messages.push({ role: "assistant", content: assistantContent });

    const toolCalls = assistantContent.filter((c) => c.type === "toolCall");
    if (toolCalls.length === 0) {
      onEvent({ type: "turn_end" });
      return;
    }

    for (const call of toolCalls) {
      signal?.throwIfAborted();
      onEvent({ type: "tool_call_start", id: call.id, name: call.name, args: call.args });
      const tool = registry.get(call.name);
      let resultMessage: ToolResultMessage;
      if (!tool) {
        resultMessage = {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: `Unknown tool: ${call.name}`,
          isError: true,
        };
      } else {
        try {
          const result = await tool.execute(call.args, cwd, signal);
          resultMessage = {
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: result.content,
            isError: result.isError ?? false,
          };
        } catch (err) {
          // Ctrl+C mid-tool-call: propagate instead of reporting it as a
          // normal tool failure, so the REPL prints "Interrupted." like it
          // does when the interrupt lands during the LLM stream instead.
          if (err instanceof Error && err.name === "AbortError") throw err;
          resultMessage = {
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: `Tool threw an error: ${(err as Error).message}`,
            isError: true,
          };
        }
      }
      messages.push(resultMessage);
      onEvent({
        type: "tool_call_end",
        id: call.id,
        name: call.name,
        content: resultMessage.content,
        isError: resultMessage.isError,
      });
    }
  }

  onEvent({
    type: "text_delta",
    text: `\n[mini] Reached max turns (${maxTurns}) without finishing; stopping.\n`,
  });
  onEvent({ type: "turn_end" });
}
