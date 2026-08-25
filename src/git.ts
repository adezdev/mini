// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { spawn } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", () => resolvePromise({ ok: false, stdout, stderr: "failed to spawn git" }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, stdout, stderr }));
  });
}

/**
 * Finds the branch mini should treat as "yours, don't pollute it": the
 * remote's default branch if there is one, else a local `main`/`master` if
 * one exists, else — no established multi-branch convention to go on — the
 * current branch itself, since it's the only line of history there is.
 *
 * Shared by checkpoint.ts (which branch to switch off of) and
 * tools/tripwires.ts (which branch a force-push shouldn't be allowed to hit).
 */
export async function resolveProtectedBranch(cwd: string, currentBranch: string | null): Promise<string | null> {
  const originHead = await runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (originHead.ok) {
    return originHead.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  }
  for (const candidate of ["main", "master"]) {
    const exists = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (exists.ok) return candidate;
  }
  return currentBranch;
}

/** Current branch name, or null if HEAD is detached (or the check fails). */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.ok && result.stdout.trim() !== "HEAD" ? result.stdout.trim() : null;
}
