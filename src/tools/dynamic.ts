// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentTool } from "../agent/types.js";

const DYNAMIC_TOOLS_DIRNAME = "tools";
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Bun's dynamic import() cache is keyed on the resolved path alone — a `?t=<mtime>` query
 * string, which would bust a browser's module cache, is silently ignored for local file
 * specifiers, so re-importing an edited tool file from its real path keeps serving back
 * whatever was imported the first time. Copying the current content to a filename that
 * actually changes with mtime sidesteps that: it's a genuinely different specifier each time
 * the file changes, so it's a fresh import instead of a cache hit.
 */
async function stagedImport(sourcePath: string, mtimeMs: number): Promise<unknown> {
  const content = await readFile(sourcePath, "utf-8");
  const cacheDir = join(tmpdir(), "mini-dynamic-tools-cache");
  await mkdir(cacheDir, { recursive: true });
  const stagedPath = join(cacheDir, `${sourcePath.replace(/[^a-zA-Z0-9]/g, "_")}-${mtimeMs}.ts`);
  await writeFile(stagedPath, content);
  return import(pathToFileURL(stagedPath).href);
}

export function dynamicToolsDir(cwd: string): string {
  return join(cwd, ".mini", DYNAMIC_TOOLS_DIRNAME);
}

function isValidTool(value: unknown): value is AgentTool {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.name === "string" &&
    NAME_PATTERN.test(t.name) &&
    typeof t.description === "string" &&
    t.description.trim().length > 0 &&
    typeof t.parameters === "object" &&
    t.parameters !== null &&
    typeof t.execute === "function"
  );
}

/**
 * Loads AgentTool-shaped files from .mini/tools/, rescanned fresh every call rather than
 * cached — repl.ts calls this once per agent-loop pass, same "cheap, retried every turn"
 * idiom maybeActivateCheckpointing uses, so a tool file written mid-session is live on the
 * very next pass with no restart and no dedicated reload command.
 */
export async function loadDynamicTools(
  cwd: string,
  builtinNames: Set<string>,
): Promise<{ tools: AgentTool[]; errors: string[] }> {
  const dir = dynamicToolsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { tools: [], errors: [] };
  }

  const tools: AgentTool[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!/\.(ts|js)$/.test(entry) || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    try {
      const { mtimeMs } = await stat(path);
      const mod = (await stagedImport(path, mtimeMs)) as Record<string, unknown>;
      const candidate = mod.default ?? mod.tool;
      if (!isValidTool(candidate)) {
        errors.push(`${entry}: does not export a valid tool (default or "tool" export)`);
        continue;
      }
      if (builtinNames.has(candidate.name)) {
        errors.push(`${entry}: name "${candidate.name}" collides with a built-in tool, skipped`);
        continue;
      }
      if (seen.has(candidate.name)) {
        errors.push(`${entry}: name "${candidate.name}" collides with another dynamic tool, skipped`);
        continue;
      }
      seen.add(candidate.name);
      tools.push(candidate);
    } catch (err) {
      errors.push(`${entry}: ${(err as Error).message}`);
    }
  }

  return { tools, errors };
}
