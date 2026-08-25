#!/usr/bin/env bun
// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Computes the semver bump implied by Conventional Commits since the last
// `v*` tag: any `!` breaking marker -> major, `feat` -> minor, `fix` ->
// patch, everything else (docs/test/chore/etc.) doesn't move the version.
// With --apply, hands the result to `bun pm version`, which does the actual
// package.json bump + commit + tag (and refuses a dirty tree on its own).

import { execSync, spawnSync } from "node:child_process";

type Bump = "major" | "minor" | "patch";

const TYPE_BUMP: Record<string, Bump | undefined> = { feat: "minor", fix: "patch" };
const SUBJECT_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._-]+\))?(!)?: /;

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function lastTag(): string | null {
  try {
    return execSync("git describe --tags --abbrev=0 --match 'v*'", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function subjectsSince(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const log = sh(`git log ${range} --format=%s`);
  return log ? log.split("\n") : [];
}

function bumpFor(subjects: string[]): Bump | null {
  let bump: Bump | null = null;
  for (const subject of subjects) {
    const match = subject.match(SUBJECT_RE);
    if (!match) continue; // non-conforming subjects don't drive a version bump
    const [, type, , breaking] = match;
    if (breaking) return "major";
    const candidate = TYPE_BUMP[type];
    if (candidate === "minor") bump = "minor";
    else if (candidate === "patch" && bump !== "minor") bump = "patch";
  }
  return bump;
}

const tag = lastTag();
const subjects = subjectsSince(tag);
const bump = bumpFor(subjects);

if (!bump) {
  console.log(`No feat/fix/breaking commits since ${tag ?? "the start of history"}; nothing to release.`);
  process.exit(1);
}

console.log(`Bump: ${bump} (${subjects.length} commit(s) since ${tag ?? "start"})`);

if (process.argv.includes("--apply")) {
  const result = spawnSync("bun", ["pm", "version", bump, "--message", "chore(release): %s"], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
