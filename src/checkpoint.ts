// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { spawn } from "node:child_process";

export interface CheckpointState {
  enabled: boolean;
  /** Why checkpointing ended up in this state — drives what, if anything, the REPL prints. */
  reason: "silent" | "dirty" | "in-place" | "new-branch";
  cwd: string;
  branch: string | null;
  originalBranch: string | null;
  commitCount: number;
}

export interface CheckpointCommitResult {
  committed: boolean;
  /** Set when the tree was dirty but the commit itself failed (e.g. a hook rejected it). */
  error?: string;
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(cwd: string, args: string[]): Promise<GitResult> {
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

function disabled(cwd: string, reason: "silent" | "dirty" = "silent"): CheckpointState {
  return { enabled: false, reason, cwd, branch: null, originalBranch: null, commitCount: 0 };
}

// Mini's own session logs land under .mini/sessions/*.jsonl inside the project directory the
// moment a session starts — excluded everywhere so mini's bookkeeping never counts as "dirty"
// and never gets swept into a checkpoint commit.
const EXCLUDE_MINI_DIR = ["--", ".", ":!.mini"];

/**
 * Finds the branch mini should treat as "yours, don't pollute it": the
 * remote's default branch if there is one, else a local `main`/`master` if
 * one exists, else — no established multi-branch convention to go on — the
 * current branch itself, since it's the only line of history there is.
 */
async function resolveProtectedBranch(cwd: string, currentBranch: string | null): Promise<string | null> {
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

/**
 * Decides whether checkpoint commits should happen this session and where.
 * Silently disables on a non-repo, a git error, or (deliberately) anything
 * we can't confidently reason about. Requires a clean starting tree — this
 * checkpoints mini's own changes, not whatever WIP was already there.
 */
export async function initCheckpointing(cwd: string, sessionId: string): Promise<CheckpointState> {
  const repoCheck = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok || repoCheck.stdout.trim() !== "true") return disabled(cwd);

  const status = await runGit(cwd, ["status", "--porcelain", ...EXCLUDE_MINI_DIR]);
  if (!status.ok) return disabled(cwd);
  if (status.stdout.trim() !== "") return disabled(cwd, "dirty");

  const branchResult = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = branchResult.ok && branchResult.stdout.trim() !== "HEAD" ? branchResult.stdout.trim() : null;

  const protectedBranch = await resolveProtectedBranch(cwd, currentBranch);
  const isProtected = currentBranch === null || currentBranch === protectedBranch;

  if (!isProtected && currentBranch) {
    return {
      enabled: true,
      reason: "in-place",
      cwd,
      branch: currentBranch,
      originalBranch: currentBranch,
      commitCount: 0,
    };
  }

  const checkpointBranch = `mini/${sessionId.slice(0, 8)}`;
  const exists = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${checkpointBranch}`]);
  const checkout = exists.ok
    ? await runGit(cwd, ["checkout", checkpointBranch])
    : await runGit(cwd, ["checkout", "-b", checkpointBranch]);
  if (!checkout.ok) return disabled(cwd);

  return {
    enabled: true,
    reason: "new-branch",
    cwd,
    branch: checkpointBranch,
    originalBranch: currentBranch,
    commitCount: 0,
  };
}

function summarizeForCommit(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "(no prompt text)";
  return collapsed.length > 72 ? `${collapsed.slice(0, 71)}…` : collapsed;
}

/** Commits whatever changed since the last checkpoint, if anything did. Runs the repo's normal hooks. */
export async function commitCheckpointIfDirty(
  state: CheckpointState,
  promptText: string,
): Promise<CheckpointCommitResult> {
  if (!state.enabled) return { committed: false };

  const status = await runGit(state.cwd, ["status", "--porcelain", ...EXCLUDE_MINI_DIR]);
  if (!status.ok) return { committed: false, error: status.stderr.trim() || "git status failed" };
  if (status.stdout.trim() === "") return { committed: false };

  const add = await runGit(state.cwd, ["add", ...EXCLUDE_MINI_DIR]);
  if (!add.ok) return { committed: false, error: add.stderr.trim() || "git add failed" };

  const commit = await runGit(state.cwd, ["commit", "-m", `mini checkpoint: ${summarizeForCommit(promptText)}`]);
  if (!commit.ok) return { committed: false, error: commit.stderr.trim() || "git commit failed" };

  state.commitCount++;
  return { committed: true };
}
