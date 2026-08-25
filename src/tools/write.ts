// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentTool } from "../agent/types.js";

export const writeTool: AgentTool = {
  name: "write",
  description: "Create a new file or overwrite an existing file with the given content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the working directory or absolute." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }, cwd: string) {
    const filePath = resolve(cwd, args.path);
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, args.content, "utf-8");
      return { content: `Wrote ${args.content.length} bytes to ${args.path}` };
    } catch (err) {
      return { content: `Error writing ${args.path}: ${(err as Error).message}`, isError: true };
    }
  },
};
