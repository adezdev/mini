// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "./agent/types.js";

const PROJECT_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "MINI.md"];

async function loadProjectInstructions(cwd: string): Promise<string | null> {
  for (const name of PROJECT_CONTEXT_FILES) {
    try {
      const content = await readFile(join(cwd, name), "utf-8");
      return content;
    } catch {
      // try next
    }
  }
  return null;
}

export async function buildSystemPrompt(tools: AgentTool[], cwd: string): Promise<string> {
  const toolLines = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const parts = [
    "You are mini, a terminal-based coding agent. You help the user with software engineering " +
      "tasks in their current project by reading and editing files and running shell commands.",
    "",
    "Available tools:",
    toolLines,
    "",
    "Use tools whenever a task requires inspecting or changing the filesystem or running commands. " +
      "Prefer the `edit` tool for targeted changes over rewriting whole files with `write`. " +
      "Be concise in your final responses to the user.",
  ];

  const projectInstructions = await loadProjectInstructions(cwd);
  if (projectInstructions) {
    parts.push("", "<project_instructions>", projectInstructions.trim(), "</project_instructions>");
  }

  parts.push("", `Current working directory: ${cwd}`);

  return parts.join("\n");
}
