// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

/**
 * Splits text into lines the way editors/diff tools count them: a trailing
 * newline terminates the last line rather than starting a new (phantom)
 * empty one. `"a\nb\n"` is 2 lines, not 3; `"a\nb"` is still 2.
 */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (text.length > 0 && text.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}
