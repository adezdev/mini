// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { AgentTool } from "../agent/types.js";
import { bashTool } from "./bash.js";
import { docsTool } from "./docs.js";
import { loadDynamicTools } from "./dynamic.js";
import { editTool } from "./edit.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

export const allTools: AgentTool[] = [readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool, docsTool];

export function toolRegistry(tools: AgentTool[] = allTools): Map<string, AgentTool> {
  return new Map(tools.map((t) => [t.name, t]));
}

const builtinNames = new Set(allTools.map((t) => t.name));

/** allTools plus whatever's currently in .mini/tools/ — rescanned fresh on every call. */
export async function getTools(cwd: string): Promise<{ tools: AgentTool[]; errors: string[] }> {
  const { tools: dynamic, errors } = await loadDynamicTools(cwd, builtinNames);
  return { tools: [...allTools, ...dynamic], errors };
}
