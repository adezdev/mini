// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentTool } from "../agent/types.js";
import { unifiedDiff } from "./diff.js";

export interface EditSpec {
  oldText: string;
  newText: string;
}

export type ApplyEditsResult = { ok: true; result: string } | { ok: false; error: string };

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = haystack.indexOf(needle, index);
    if (index === -1) break;
    count++;
    index += needle.length;
  }
  return count;
}

/**
 * Applies all edits against the *original* content (not chained
 * sequentially), requiring each `oldText` to match exactly once. This is a
 * pure function so it's directly unit-testable without touching the
 * filesystem.
 */
export function applyEdits(original: string, edits: EditSpec[]): ApplyEditsResult {
  for (const edit of edits) {
    const occurrences = countOccurrences(original, edit.oldText);
    if (occurrences === 0) {
      return { ok: false, error: `oldText not found in file: ${JSON.stringify(edit.oldText.slice(0, 200))}` };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: `oldText matches ${occurrences} times, must match exactly once: ${JSON.stringify(edit.oldText.slice(0, 200))}`,
      };
    }
  }

  const replacements = edits
    .map((edit) => ({ start: original.indexOf(edit.oldText), edit }))
    .sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const { start, edit } of replacements) {
    result += original.slice(cursor, start) + edit.newText;
    cursor = start + edit.oldText.length;
  }
  result += original.slice(cursor);

  return { ok: true, result };
}

function normalizeToLF(text: string): { normalized: string; usedCRLF: boolean } {
  const usedCRLF = text.includes("\r\n");
  return { normalized: text.replace(/\r\n/g, "\n"), usedCRLF };
}

export const editTool: AgentTool = {
  name: "edit",
  description:
    "Apply one or more exact string replacements to a file. Each `oldText` must appear exactly once " +
    "in the file's current content. Returns a unified diff of the change.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the working directory or absolute." },
      edits: {
        type: "array",
        description: "List of non-overlapping replacements to apply.",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string", description: "Exact text to find (must be unique in the file)." },
            newText: { type: "string", description: "Text to replace it with." },
          },
          required: ["oldText", "newText"],
        },
      },
    },
    required: ["path", "edits"],
  },
  async execute(args: { path: string; edits: EditSpec[] }, cwd: string) {
    const filePath = resolve(cwd, args.path);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      return { content: `Error reading ${args.path}: ${(err as Error).message}`, isError: true };
    }

    const { normalized, usedCRLF } = normalizeToLF(raw);
    const normalizedEdits = args.edits.map((e) => ({
      oldText: e.oldText.replace(/\r\n/g, "\n"),
      newText: e.newText.replace(/\r\n/g, "\n"),
    }));

    const applied = applyEdits(normalized, normalizedEdits);
    if (!applied.ok) {
      return { content: applied.error, isError: true };
    }

    const finalContent = usedCRLF ? applied.result.replace(/\n/g, "\r\n") : applied.result;
    try {
      await writeFile(filePath, finalContent, "utf-8");
    } catch (err) {
      return { content: `Error writing ${args.path}: ${(err as Error).message}`, isError: true };
    }

    const diff = unifiedDiff(normalized, applied.result);
    return { content: diff };
  },
};
