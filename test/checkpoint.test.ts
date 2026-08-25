import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { commitCheckpointIfDirty, initCheckpointing } from "../src/checkpoint.js";

let dir: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(cwd: string, branch: string): void {
  git(cwd, ["init", "-q", "-b", branch]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  git(cwd, ["config", "commit.gpgsign", "false"]);
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-checkpoint-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("disabled, silently, when the directory isn't a git repo", async () => {
  const notARepo = await mkdtemp(join(tmpdir(), "mini-checkpoint-norepo-"));
  try {
    const state = await initCheckpointing(notARepo, "session-abc");
    assert.equal(state.enabled, false);
    assert.equal(state.reason, "silent");
  } finally {
    await rm(notARepo, { recursive: true, force: true });
  }
});

test("disabled with reason 'dirty' when the starting tree has uncommitted changes", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-dirty-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);
    await writeFile(join(repo, "README.md"), "dirty change");

    const state = await initCheckpointing(repo, "session-dirty");
    assert.equal(state.enabled, false);
    assert.equal(state.reason, "dirty");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("creates and switches to a mini/ branch when starting on main", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-main-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);

    const state = await initCheckpointing(repo, "abcdef1234567890");
    assert.equal(state.enabled, true);
    assert.equal(state.reason, "new-branch");
    assert.equal(state.branch, "mini/abcdef12");
    assert.equal(state.originalBranch, "main");
    assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "mini/abcdef12");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("commits checkpoints in place when already on a non-default branch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-topic-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);
    git(repo, ["checkout", "-q", "-b", "my-feature"]);

    const state = await initCheckpointing(repo, "session-xyz");
    assert.equal(state.enabled, true);
    assert.equal(state.reason, "in-place");
    assert.equal(state.branch, "my-feature");
    assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "my-feature");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("treats detached HEAD as protected and switches to a mini/ branch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-detached-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);
    const sha = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["checkout", "-q", sha]);

    const state = await initCheckpointing(repo, "session-detached");
    assert.equal(state.enabled, true);
    assert.equal(state.reason, "new-branch");
    assert.equal(state.originalBranch, null);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("prefers the remote's default branch over a locally-guessed main/master", async () => {
  const remote = await mkdtemp(join(tmpdir(), "mini-checkpoint-remote-"));
  const clone = await mkdtemp(join(tmpdir(), "mini-checkpoint-clone-"));
  try {
    git(remote, ["init", "-q", "-b", "trunk", "--bare"]);
    const seed = await mkdtemp(join(tmpdir(), "mini-checkpoint-seed-"));
    try {
      initRepo(seed, "trunk");
      await writeFile(join(seed, "README.md"), "hello");
      git(seed, ["add", "-A"]);
      git(seed, ["commit", "-q", "-m", "initial"]);
      git(seed, ["remote", "add", "origin", remote]);
      git(seed, ["push", "-q", "origin", "trunk"]);
    } finally {
      await rm(seed, { recursive: true, force: true });
    }
    execFileSync("git", ["clone", "-q", remote, clone], { encoding: "utf-8" });
    git(clone, ["config", "user.email", "test@example.com"]);
    git(clone, ["config", "user.name", "Test"]);

    const state = await initCheckpointing(clone, "session-remote");
    assert.equal(state.enabled, true);
    assert.equal(state.reason, "new-branch"); // "trunk" resolved as the protected branch via origin/HEAD
  } finally {
    await rm(remote, { recursive: true, force: true });
    await rm(clone, { recursive: true, force: true });
  }
});

test("commitCheckpointIfDirty commits changes and increments commitCount, no-ops when clean", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-commit-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);
    git(repo, ["checkout", "-q", "-b", "my-feature"]);

    const state = await initCheckpointing(repo, "session-commit");
    assert.equal(state.commitCount, 0);

    const noop = await commitCheckpointIfDirty(state, "nothing changed yet");
    assert.equal(noop.committed, false);
    assert.equal(state.commitCount, 0);

    await writeFile(join(repo, "README.md"), "changed");
    const first = await commitCheckpointIfDirty(state, "make a change");
    assert.equal(first.committed, true);
    assert.equal(state.commitCount, 1);
    assert.match(git(repo, ["log", "-1", "--format=%s"]), /mini checkpoint: make a change/);

    const second = await commitCheckpointIfDirty(state, "nothing changed again");
    assert.equal(second.committed, false);
    assert.equal(state.commitCount, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("commitCheckpointIfDirty is a no-op when checkpointing is disabled", async () => {
  const notARepo = await mkdtemp(join(tmpdir(), "mini-checkpoint-disabled-"));
  try {
    const state = await initCheckpointing(notARepo, "session-disabled");
    const result = await commitCheckpointIfDirty(state, "anything");
    assert.equal(result.committed, false);
    assert.equal(result.error, undefined);
  } finally {
    await rm(notARepo, { recursive: true, force: true });
  }
});

test("resuming the same session id reuses its existing mini/ branch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "mini-checkpoint-resume-"));
  try {
    initRepo(repo, "main");
    await writeFile(join(repo, "README.md"), "hello");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "initial"]);

    const first = await initCheckpointing(repo, "resume-session-1");
    await writeFile(join(repo, "README.md"), "first pass");
    await commitCheckpointIfDirty(first, "first pass");

    git(repo, ["checkout", "-q", "main"]);
    const second = await initCheckpointing(repo, "resume-session-1");
    assert.equal(second.branch, first.branch);
    assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), first.branch);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
