// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { relative, resolve } from "node:path";
import type { AgentTool } from "../agent/types.js";
import { globToRegExp, loadGitignorePatterns, walkFiles } from "./walk.js";

const MAX_RESULTS = 200;

interface FindArgs {
  pattern: string;
  path?: string;
}

export async function findFiles(root: string, args: FindArgs): Promise<{ files: string[]; truncated: boolean }> {
  const searchRoot = args.path ? resolve(root, args.path) : root;
  const gitignorePatterns = await loadGitignorePatterns(root);
  // A pattern with a slash matches against the full relative path; otherwise just the basename.
  const matchFullPath = args.pattern.includes("/");
  const regex = globToRegExp(args.pattern);

  const files: string[] = [];
  let truncated = false;

  for await (const file of walkFiles(searchRoot, gitignorePatterns)) {
    if (files.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    const relPath = relative(root, file);
    const candidate = matchFullPath ? relPath : (relPath.split("/").pop() ?? relPath);
    if (regex.test(candidate)) files.push(relPath);
  }

  return { files: files.sort(), truncated };
}

export const findTool: AgentTool = {
  name: "find",
  description:
    "Find files by glob pattern (recursively, honoring .gitignore). Matches against the " +
    "filename, or the full relative path if the pattern contains '/'. Returns matching paths.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, e.g. '*.ts' or 'src/**/*.test.ts'." },
      path: { type: "string", description: "Directory to search, relative to cwd (default: cwd)." },
    },
    required: ["pattern"],
  },
  async execute(args: FindArgs, cwd: string) {
    let result: Awaited<ReturnType<typeof findFiles>>;
    try {
      result = await findFiles(cwd, args);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    if (result.files.length === 0) {
      return { content: "No files found." };
    }
    const trailer = result.truncated ? `\n[Results truncated at ${MAX_RESULTS} files.]` : "";
    return { content: result.files.join("\n") + trailer };
  },
};
