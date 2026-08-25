// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { AgentTool } from "../agent/types.js";
import { splitLines } from "./lines.js";
import { resolveInRoot } from "./path-guard.js";
import { globToRegExp, loadGitignorePatterns, walkFiles } from "./walk.js";

const MAX_MATCHES = 200;

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export async function searchFiles(root: string, args: GrepArgs): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const flags = args.ignoreCase ? "i" : "";
  const source = args.literal ? args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : args.pattern;
  const regex = new RegExp(source, flags);

  const searchRoot = args.path ? resolve(root, args.path) : root;
  const gitignorePatterns = await loadGitignorePatterns(root);
  const fileGlob = args.glob ? globToRegExp(args.glob) : null;

  const matches: GrepMatch[] = [];
  let truncated = false;

  for await (const file of walkFiles(searchRoot, gitignorePatterns)) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    const relPath = relative(root, file);
    if (fileGlob && !fileGlob.test(relPath.split("/").pop() ?? relPath)) continue;

    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue; // skip binaries

    const lines = splitLines(content);
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: relPath, line: i + 1, text: lines[i] });
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
      }
    }
  }

  return { matches, truncated };
}

export const grepTool: AgentTool = {
  name: "grep",
  description:
    "Search file contents for a regular expression pattern (recursively, honoring .gitignore). " +
    "Returns matching lines as `path:line: text`.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression (or literal string if literal=true)." },
      path: { type: "string", description: "Directory to search, relative to cwd (default: cwd)." },
      glob: { type: "string", description: "Only search filenames matching this glob, e.g. '*.ts'." },
      ignoreCase: { type: "boolean", description: "Case-insensitive matching." },
      literal: { type: "boolean", description: "Treat pattern as a literal string, not a regex." },
    },
    required: ["pattern"],
  },
  async execute(args: GrepArgs, cwd: string) {
    if (args.path) {
      const guarded = resolveInRoot(cwd, args.path);
      if (!guarded.ok) return { content: guarded.error, isError: true };
    }
    let searchResult: Awaited<ReturnType<typeof searchFiles>>;
    try {
      searchResult = await searchFiles(cwd, args);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    if (searchResult.matches.length === 0) {
      return { content: "No matches found." };
    }
    const lines = searchResult.matches.map((m) => `${m.file}:${m.line}: ${m.text}`);
    const trailer = searchResult.truncated ? `\n[Results truncated at ${MAX_MATCHES} matches.]` : "";
    return { content: lines.join("\n") + trailer };
  },
};
