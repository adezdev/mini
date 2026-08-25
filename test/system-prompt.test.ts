import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AgentTool } from "../src/agent/types.js";
import { buildSystemPrompt } from "../src/system-prompt.js";

const fakeTools: AgentTool[] = [
  {
    name: "ls",
    description: "List files.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "" }),
  },
  {
    name: "read",
    description: "Read a file.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "" }),
  },
];

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-system-prompt-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("lists each tool's name and description, and the cwd", async () => {
  const prompt = await buildSystemPrompt(fakeTools, dir);
  assert.match(prompt, /- ls: List files\.\n- read: Read a file\./);
  assert.match(prompt, new RegExp(`Current working directory: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
});

test("omits <project_instructions> when no project context file exists", async () => {
  const prompt = await buildSystemPrompt(fakeTools, dir);
  assert.ok(!prompt.includes("<project_instructions>"));
});

test("injects AGENTS.md content into <project_instructions> when present", async () => {
  const agentsDir = await mkdtemp(join(tmpdir(), "mini-system-prompt-agents-"));
  try {
    await writeFile(join(agentsDir, "AGENTS.md"), "Follow these repo rules.");
    const prompt = await buildSystemPrompt(fakeTools, agentsDir);
    assert.match(prompt, /<project_instructions>\nFollow these repo rules\.\n<\/project_instructions>/);
  } finally {
    await rm(agentsDir, { recursive: true, force: true });
  }
});

test("prefers AGENTS.md over CLAUDE.md over MINI.md when multiple exist", async () => {
  const multiDir = await mkdtemp(join(tmpdir(), "mini-system-prompt-multi-"));
  try {
    await writeFile(join(multiDir, "AGENTS.md"), "from agents");
    await writeFile(join(multiDir, "CLAUDE.md"), "from claude");
    await writeFile(join(multiDir, "MINI.md"), "from mini");
    const prompt = await buildSystemPrompt(fakeTools, multiDir);
    assert.match(prompt, /from agents/);
    assert.ok(!prompt.includes("from claude"));
    assert.ok(!prompt.includes("from mini"));
  } finally {
    await rm(multiDir, { recursive: true, force: true });
  }
});

test("falls back to MINI.md when AGENTS.md and CLAUDE.md are absent", async () => {
  const miniDir = await mkdtemp(join(tmpdir(), "mini-system-prompt-mini-"));
  try {
    await writeFile(join(miniDir, "MINI.md"), "mini-only instructions");
    const prompt = await buildSystemPrompt(fakeTools, miniDir);
    assert.match(prompt, /mini-only instructions/);
  } finally {
    await rm(miniDir, { recursive: true, force: true });
  }
});
