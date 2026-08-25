// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

/**
 * A small, dependency-free unified-diff generator. Uses an O(n*m)
 * longest-common-subsequence table, which is fine for the file sizes a
 * coding agent typically edits; falls back to a coarse whole-block diff
 * for very large inputs to avoid quadratic blowup.
 */
import { splitLines } from "./lines.js";

const LCS_LINE_CAP = 4000;

export function unifiedDiff(oldText: string, newText: string, context = 3): string {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length * newLines.length > LCS_LINE_CAP * LCS_LINE_CAP) {
    return `--- before\n+++ after\n@@ large change, ${oldLines.length} -> ${newLines.length} lines @@\n`;
  }

  const ops = diffLines(oldLines, newLines);
  return formatUnifiedDiff(ops, context);
}

type DiffOp = { type: "equal"; line: string } | { type: "delete"; line: string } | { type: "insert"; line: string };

function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", line: a[i] });
      i++;
    } else {
      ops.push({ type: "insert", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "delete", line: a[i++] });
  while (j < m) ops.push({ type: "insert", line: b[j++] });
  return ops;
}

function formatUnifiedDiff(ops: DiffOp[], context: number): string {
  const lines: string[] = ["--- before", "+++ after"];
  let oldLine = 1;
  let newLine = 1;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === "equal") {
      oldLine++;
      newLine++;
      i++;
      continue;
    }

    // Start of a change hunk: back up `context` equal lines.
    let hunkStart = i;
    let backed = 0;
    while (hunkStart > 0 && ops[hunkStart - 1].type === "equal" && backed < context) {
      hunkStart--;
      backed++;
    }

    let hunkEnd = i;
    let trailingEqual = 0;
    while (hunkEnd < ops.length) {
      if (ops[hunkEnd].type !== "equal") {
        trailingEqual = 0;
      } else {
        trailingEqual++;
        if (trailingEqual > context) break;
      }
      hunkEnd++;
    }
    hunkEnd = Math.min(hunkEnd, ops.length);

    const hunkOldStart = oldLine - backed;
    const hunkNewStart = newLine - backed;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = hunkStart; k < hunkEnd; k++) {
      const op = ops[k];
      if (op.type === "equal") {
        body.push(` ${op.line}`);
        oldCount++;
        newCount++;
      } else if (op.type === "delete") {
        body.push(`-${op.line}`);
        oldCount++;
      } else {
        body.push(`+${op.line}`);
        newCount++;
      }
    }
    lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
    lines.push(...body);

    // Advance oldLine/newLine to the state at hunkEnd.
    for (let k = i; k < hunkEnd; k++) {
      if (ops[k].type !== "insert") oldLine++;
      if (ops[k].type !== "delete") newLine++;
    }
    i = hunkEnd;
  }

  return `${lines.join("\n")}\n`;
}
