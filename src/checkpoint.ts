// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { getCurrentBranch, resolveProtectedBranch, runGit } from "./git.js";

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

function disabled(cwd: string, reason: "silent" | "dirty" = "silent"): CheckpointState {
  return { enabled: false, reason, cwd, branch: null, originalBranch: null, commitCount: 0 };
}

// Mini's own session logs land under .mini/sessions/*.jsonl inside the project directory the
// moment a session starts — excluded everywhere so mini's bookkeeping never counts as "dirty"
// and never gets swept into a checkpoint commit.
const EXCLUDE_MINI_DIR = ["--", ".", ":!.mini"];

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

  const currentBranch = await getCurrentBranch(cwd);
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
