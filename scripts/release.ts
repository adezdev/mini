#!/usr/bin/env bun
// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Cuts a release: run checks, let scripts/version.ts figure out the bump and
// hand it to `bun pm version` (which bumps package.json, commits, and tags),
// then optionally push and publish a GitHub release with the compiled binary.
//
// Usage:
//   bun run release                  # bump, commit, tag (local only)
//   bun run release -- --push        # also push the commit and tag
//   bun run release -- --publish     # push + build dist/mini + gh release
//   bun run release -- --skip-checks # skip typecheck/test (not recommended)

import { execSync, spawnSync } from "node:child_process";

function run(cmd: string, args: string[]): void {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} exited with status ${result.status}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function releaseNotes(previousTag: string | null): string {
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const subjects = sh(`git log ${range} --format=%s`).split("\n").filter(Boolean);
  const groups: Record<string, string[]> = { Features: [], Fixes: [], Other: [] };
  for (const subject of subjects) {
    if (/^feat/.test(subject)) groups.Features.push(subject);
    else if (/^fix/.test(subject)) groups.Fixes.push(subject);
    else groups.Other.push(subject);
  }
  return Object.entries(groups)
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => `## ${heading}\n${lines.map((l) => `- ${l}`).join("\n")}`)
    .join("\n\n");
}

const push = process.argv.includes("--push") || process.argv.includes("--publish");
const publish = process.argv.includes("--publish");
const skipChecks = process.argv.includes("--skip-checks");

if (!skipChecks) {
  run("bun", ["run", "typecheck"]);
  run("bun", ["run", "test"]);
}

let previousTag: string | null;
try {
  previousTag = execSync("git describe --tags --abbrev=0 --match 'v*'", {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  previousTag = null;
}
const notes = releaseNotes(previousTag);

const versionResult = spawnSync("bun", ["scripts/version.ts", "--apply"], { stdio: "inherit" });
if (versionResult.status !== 0) {
  process.exit(0); // version.ts already explained why there's nothing to release
}

const tagName = sh("git describe --tags --abbrev=0");
console.log(`\nTagged ${tagName}.`);

if (!push) {
  console.log(`Run with --push to push the commit and tag, or --publish to also cut a GitHub release.`);
  process.exit(0);
}

run("git", ["push"]);
run("git", ["push", "origin", tagName]);

if (publish) {
  run("bun", ["run", "compile"]);
  run("gh", ["release", "create", tagName, "dist/mini", "--title", tagName, "--notes", notes]);
}
