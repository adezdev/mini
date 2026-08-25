// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  args: unknown;
}

export type AssistantContent = TextContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (an "object" schema). */
  parameters: Record<string, unknown>;
  execute(args: any, cwd: string): Promise<ToolResult>;
}
