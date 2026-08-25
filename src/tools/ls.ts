// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import type { AgentTool } from "../agent/types.js";
import { resolveInRoot } from "./path-guard.js";

const ALWAYS_IGNORED = new Set([".git", "node_modules", "dist", ".mini"]);

export const lsTool: AgentTool = {
  name: "ls",
  description: "List files and directories at a given path (non-recursive).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list, relative to cwd (default: cwd)." },
    },
    required: [],
  },
  async execute(args: { path?: string }, cwd: string) {
    let dirPath = cwd;
    if (args.path) {
      const guarded = resolveInRoot(cwd, args.path);
      if (!guarded.ok) return { content: guarded.error, isError: true };
      dirPath = guarded.path;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      return { content: `Error listing ${args.path ?? "."}: ${(err as Error).message}`, isError: true };
    }
    const lines = entries
      .filter((e) => !ALWAYS_IGNORED.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return { content: lines.length > 0 ? lines.join("\n") : "(empty directory)" };
  },
};
