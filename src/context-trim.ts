// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import type { Message } from "./agent/types.js";

// Recent tool output is still what the model is actively reasoning about;
// older large output has usually been superseded by a later read/edit of the
// same thing, so it's dead weight paid for on every remaining turn. Keep the
// last few turns verbatim, collapse anything large and older than that.
const STALE_TURNS = 3;
const STALE_MIN_CHARS = 2000;
const TRIM_MARKER = "[trimmed:";

export function contextTrimEnabled(): boolean {
  return process.env.MINI_CONTEXT_TRIM !== "0";
}

/**
 * Collapses large tool-result content from turns older than STALE_TURNS.
 * Mutates `messages` in place — the session log already captured the
 * original content when it was first appended, so nothing on disk is lost.
 */
export function trimStaleToolOutput(messages: Message[]): void {
  if (!contextTrimEnabled()) return;

  let turnsAgo = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      turnsAgo++;
      continue;
    }
    if (
      m.role === "toolResult" &&
      turnsAgo >= STALE_TURNS &&
      m.content.length > STALE_MIN_CHARS &&
      !m.content.startsWith(TRIM_MARKER)
    ) {
      m.content = `${TRIM_MARKER} ${m.toolName} output, ${m.content.length} chars, ${turnsAgo} turns ago — re-run the tool if you need it again]`;
    }
  }
}
