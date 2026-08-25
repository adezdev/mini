// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { runAgentLoop } from "./agent/loop.js";
import type { Message } from "./agent/types.js";
import type { Config } from "./config.js";
import { unifiedDiff } from "./tools/diff.js";
import { applyEdits, type EditSpec } from "./tools/edit.js";

const REFINE_INSTRUCTION = `Review this session against the current CLAUDE.md content below and propose edits that
capture anything a future contributor would need to know but isn't documented yet: new
conventions established, gotchas hit, or subsystems whose shape changed. Skip anything already
covered, and skip normal day-to-day work that didn't teach anything new.

Respond with ONLY a JSON array of edits, each {"oldText": "...", "newText": "..."} — the same
shape the edit tool takes. oldText must match the CLAUDE.md content below exactly, once.
Respond with an empty array [] if there's nothing worth adding. No prose, no markdown fences.

Current CLAUDE.md:
---
`;

/**
 * Pulls a JSON array out of a model response that may still have prose or
 * markdown fences around it despite being asked not to.
 */
export function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON array found in the model's response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function isEditSpec(value: unknown): value is EditSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EditSpec).oldText === "string" &&
    typeof (value as EditSpec).newText === "string"
  );
}

/** Asks the model what, if anything, this session taught it worth adding to CLAUDE.md. */
export async function proposeRefinements(
  config: Config,
  messages: Message[],
  claudeMdContent: string,
): Promise<EditSpec[]> {
  const scratch: Message[] = [...messages, { role: "user", content: `${REFINE_INSTRUCTION}${claudeMdContent}\n---` }];
  let response = "";
  await runAgentLoop({
    apiKey: config.apiKey,
    model: config.model,
    messages: scratch,
    tools: [],
    maxTurns: config.maxTurns,
    onEvent(event) {
      if (event.type === "text_delta") response += event.text;
    },
  });

  const parsed = extractJsonArray(response.trim());
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array of edits");
  if (!parsed.every(isEditSpec)) throw new Error("malformed edit in response (expected {oldText, newText})");
  return parsed;
}

export interface RefineResult {
  edits: EditSpec[];
  diff: string;
  newContent: string;
}

/**
 * Proposes edits and applies them (in memory, not to disk) against
 * `claudeMdContent` so the caller can show a diff before writing anything.
 * Returns null when the model found nothing worth adding.
 */
export async function computeRefinement(
  config: Config,
  messages: Message[],
  claudeMdContent: string,
): Promise<RefineResult | null> {
  const edits = await proposeRefinements(config, messages, claudeMdContent);
  if (edits.length === 0) return null;

  const applied = applyEdits(claudeMdContent, edits);
  if (!applied.ok) throw new Error(applied.error);

  return { edits, diff: unifiedDiff(claudeMdContent, applied.result), newContent: applied.result };
}
