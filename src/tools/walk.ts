// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const ALWAYS_IGNORED = new Set([".git", "node_modules", "dist", ".mini"]);

/** Very small glob matcher: only `*` (any run of chars) is supported. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export async function loadGitignorePatterns(root: string): Promise<string[]> {
  try {
    const raw = await readFile(join(root, ".gitignore"), "utf-8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function isIgnored(name: string, gitignorePatterns: string[]): boolean {
  if (ALWAYS_IGNORED.has(name)) return true;
  for (const pattern of gitignorePatterns) {
    const cleanPattern = pattern.replace(/\/$/, "");
    if (cleanPattern === name) return true;
    if (cleanPattern.includes("*") && globToRegExp(cleanPattern).test(name)) return true;
  }
  return false;
}

/** Recursively yields file paths under `dir`, skipping always-ignored and gitignored entries. */
export async function* walkFiles(dir: string, gitignorePatterns: string[]): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (isIgnored(entry.name, gitignorePatterns)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, gitignorePatterns);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
