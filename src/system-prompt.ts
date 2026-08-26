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
    "",
    "A few things mini does automatically — expect them, don't treat them as surprises or as " +
      "the user intervening: after a turn where you changed files, you may immediately get a " +
      "follow-up turn asking you to verify and fix your own work (prefixed `[auto self-check]`) " +
      "— treat it as a normal continuation. If the project is a clean git repository, mini also " +
      "commits your changes after each turn on its own (on a dedicated branch if the session " +
      "started on the repo's default branch), so you don't need to run `git commit` yourself " +
      "unless the user asks for something specific there. The `bash` tool refuses a small set of " +
      "unambiguously destructive commands outright (e.g. a whole-filesystem `rm -rf /`, or " +
      "force-pushing the repo's default branch) — if refused, don't retry the same command, use " +
      "a narrower one that does what you actually meant. You can also extend your own tool list: " +
      "an AgentTool-shaped file written to `.mini/tools/` is picked up automatically, no restart " +
      "needed — check the `docs` tool's `extending` topic for the contract before writing one. The " +
      "new tool is NOT available within the same reply you wrote it in — the tool list only " +
      "refreshes at the start of the next pass. It IS already there by the `[auto self-check]` " +
      "follow-up that fires right after, so don't fake-test it by re-implementing its logic inline " +
      "in `bash`; just call it for real once you get that next turn. Don't sanity-check a `.ts` " +
      "tool file with plain `node` either — mini loads it through Bun's TS transpiler, and Node " +
      "will fail on a type annotation with a confusing syntax error that has nothing to do with " +
      "whether the file actually works.",
  ];

  const projectInstructions = await loadProjectInstructions(cwd);
  if (projectInstructions) {
    parts.push("", "<project_instructions>", projectInstructions.trim(), "</project_instructions>");
  }

  parts.push("", `Current working directory: ${cwd}`);

  return parts.join("\n");
}
