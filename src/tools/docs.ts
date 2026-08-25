// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Embedded at build time (Bun's text loader, typed via src/global.d.ts) so this
// works identically from source, `bun link`, or the compiled dist/mini binary —
// no filesystem read relative to an install path, and no path the model could
// ever supply to make this tool read anything outside this fixed set.
import architectureDoc from "../../docs/architecture.md" with { type: "text" };
import cliDoc from "../../docs/cli.md" with { type: "text" };
import gettingStartedDoc from "../../docs/getting-started.md" with { type: "text" };
import guardrailsDoc from "../../docs/guardrails.md" with { type: "text" };
import indexDoc from "../../docs/README.md" with { type: "text" };
import replCommandsDoc from "../../docs/repl-commands.md" with { type: "text" };
import toolsDoc from "../../docs/tools.md" with { type: "text" };
import type { AgentTool } from "../agent/types.js";

interface DocEntry {
  title: string;
  summary: string;
  content: string;
}

const DOCS: Record<string, DocEntry> = {
  index: { title: "Index", summary: "Overview of all the docs below.", content: indexDoc },
  "getting-started": {
    title: "Getting Started",
    summary: "Install, set up an API key, run a first session.",
    content: gettingStartedDoc,
  },
  cli: { title: "CLI Reference", summary: "Flags and environment variables.", content: cliDoc },
  "repl-commands": {
    title: "REPL Commands",
    summary: "Every interactive /command.",
    content: replCommandsDoc,
  },
  tools: { title: "Built-in Tools", summary: "The eight tools mini can call.", content: toolsDoc },
  guardrails: {
    title: "Guardrails",
    summary: "Checkpointing, self-check, bash tripwires, the filesystem boundary.",
    content: guardrailsDoc,
  },
  architecture: {
    title: "Architecture",
    summary: "Internals, for anyone changing mini's own code.",
    content: architectureDoc,
  },
};

function formatIndex(): string {
  const lines = Object.entries(DOCS).map(([key, doc]) => `- ${key}: ${doc.title} — ${doc.summary}`);
  return `mini's own documentation. Call again with a "topic" to read one in full.\n\n${lines.join("\n")}`;
}

export const docsTool: AgentTool = {
  name: "docs",
  description:
    "Look up mini's own documentation — how to use mini, its REPL commands, its tools, or the " +
    "guardrails that keep an unattended session safe. Call with no topic to list what's " +
    "available, or a topic key to read it in full. Use this instead of guessing when a user " +
    "asks how mini works or how to use a feature.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: `One of: ${Object.keys(DOCS).join(", ")}. Omit to list all topics.`,
      },
    },
    required: [],
  },
  async execute(args: { topic?: string }) {
    if (!args.topic) return { content: formatIndex() };

    const key = args.topic.trim().toLowerCase().replace(/\s+/g, "-");
    const doc = DOCS[key];
    if (!doc) {
      return { content: `No doc for "${args.topic}".\n\n${formatIndex()}`, isError: true };
    }
    return { content: doc.content };
  },
};
