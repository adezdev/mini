// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { AgentTool } from "../agent/types.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

export const allTools: AgentTool[] = [readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool];

export function toolRegistry(tools: AgentTool[] = allTools): Map<string, AgentTool> {
  return new Map(tools.map((t) => [t.name, t]));
}
