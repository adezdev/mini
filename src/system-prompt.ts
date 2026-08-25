// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "./agent/types.js";

// Most mini-specific wins: its own native file first, then this repo's actual
// convention (CLAUDE.md), then the generic cross-tool fallback.
const PROJECT_CONTEXT_FILES = ["MINI.md", "CLAUDE.md", "AGENTS.md"];

/** Finds whichever project instructions file mini would load, first match wins. */
export async function findProjectInstructionsPath(cwd: string): Promise<string | null> {
  for (const name of PROJECT_CONTEXT_FILES) {
    const path = join(cwd, name);
    try {
      await readFile(path, "utf-8");
      return path;
    } catch {
      // try next
    }
  }
  return null;
}

async function loadProjectInstructions(cwd: string): Promise<string | null> {
  const path = await findProjectInstructionsPath(cwd);
  return path ? readFile(path, "utf-8") : null;
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
