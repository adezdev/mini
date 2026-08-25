// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentTool } from "../agent/types.js";
import { splitLines } from "./lines.js";

const MAX_LINES = 2000;
const MAX_BYTES = 256 * 1024;

export const readTool: AgentTool = {
  name: "read",
  description:
    "Read a text file from disk. Supports reading a slice via offset/limit for large files. " +
    "Returns line-numbered content, truncated if it exceeds size limits.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the working directory or absolute." },
      offset: { type: "number", description: "1-indexed line number to start reading from (default 1)." },
      limit: { type: "number", description: `Maximum number of lines to return (default ${MAX_LINES}).` },
    },
    required: ["path"],
  },
  async execute(args: { path: string; offset?: number; limit?: number }, cwd: string) {
    const filePath = resolve(cwd, args.path);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      return { content: `Error reading ${args.path}: ${(err as Error).message}`, isError: true };
    }
    if (raw.includes("\0")) {
      return { content: `Error reading ${args.path}: file appears to be binary, not text.`, isError: true };
    }

    const lines = splitLines(raw);
    const totalLines = lines.length;
    const offset = Math.max(1, args.offset ?? 1);
    const limit = Math.min(args.limit ?? MAX_LINES, MAX_LINES);

    let sliceLines = lines.slice(offset - 1, offset - 1 + limit);
    let byteCount = 0;
    let cutoff = sliceLines.length;
    for (let i = 0; i < sliceLines.length; i++) {
      byteCount += Buffer.byteLength(sliceLines[i], "utf-8") + 1;
      if (byteCount > MAX_BYTES) {
        cutoff = i;
        break;
      }
    }
    const truncated = cutoff < sliceLines.length;
    sliceLines = sliceLines.slice(0, cutoff);

    const lastLine = offset - 1 + sliceLines.length;
    const numbered = sliceLines.map((line, i) => `${offset + i}\t${line}`).join("\n");

    const hitLineLimit = offset - 1 + limit < totalLines && !truncated;
    let trailer = "";
    if (truncated || hitLineLimit) {
      trailer = `\n[Showing lines ${offset}-${lastLine} of ${totalLines}. Use offset=${lastLine + 1} to continue.]`;
    }

    return { content: numbered + trailer };
  },
};
