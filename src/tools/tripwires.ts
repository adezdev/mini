// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Last-resort circuit breaker for the bash tool: a small, high-confidence deny-list of
// unambiguously destructive commands. Guards against an honest mistake (a hallucinated bad
// path), not a determined jailbreak trying to obfuscate around it — that needs a real sandbox,
// which is out of scope here. Deliberately not a permission system: no in-band override, since
// a model that could flip a "force: true" flag would just learn to always flip it.

import { getCurrentBranch, resolveProtectedBranch } from "../git.js";

const CURL_SUDO_PIPE = /\b(curl|wget)\b[^\n]*\|\s*sudo\s+(sh|bash|zsh|dash)\b/i;

function splitCommands(command: string): string[] {
  return command
    .split(/;|&&|\|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isRootWipe(subCommand: string): boolean {
  const tokens = subCommand.split(/\s+/).filter(Boolean);
  const rmIndex = tokens.findIndex((t) => t === "rm" || t.endsWith("/rm"));
  if (rmIndex === -1) return false;

  let hasRecursive = false;
  let hasForce = false;
  const targets: string[] = [];

  for (const token of tokens.slice(rmIndex + 1)) {
    if (token === "--recursive") {
      hasRecursive = true;
    } else if (token === "--force") {
      hasForce = true;
    } else if (/^-[a-zA-Z]+$/.test(token)) {
      if (/[rR]/.test(token)) hasRecursive = true;
      if (token.includes("f")) hasForce = true;
    } else if (token.startsWith("-")) {
      // some other flag (-i, --verbose, etc.) — ignore
    } else {
      targets.push(token.replace(/^["']|["']$/g, ""));
    }
  }

  if (!hasRecursive || !hasForce) return false;
  const BRACED_HOME = "$" + "{HOME}";
  return targets.some((t) => t === "/" || t === "~" || t === "$HOME" || t === BRACED_HOME || /^\/\*+$/.test(t));
}

function isForcePushFlag(token: string): boolean {
  return (
    token === "-f" || token === "--force" || token === "--force-with-lease" || token.startsWith("--force-with-lease=")
  );
}

/** Parses a `git push` invocation, if that's what this sub-command is. */
function parseGitPush(subCommand: string): { forced: boolean; refspec: string | null } | null {
  const tokens = subCommand.split(/\s+/).filter(Boolean);
  if (tokens[0] !== "git" || tokens[1] !== "push") return null;

  let forced = false;
  const positional: string[] = [];
  for (const token of tokens.slice(2)) {
    if (isForcePushFlag(token)) forced = true;
    else if (!token.startsWith("-")) positional.push(token);
  }
  // First positional is the remote (e.g. "origin"); second, if present, is the refspec.
  return { forced, refspec: positional[1] ?? null };
}

/** Refuses a `git push --force` (or --force-with-lease) that targets the repo's protected branch. */
async function checkGitForcePush(command: string, cwd: string): Promise<string | null> {
  for (const sub of splitCommands(command)) {
    const parsed = parseGitPush(sub);
    if (!parsed?.forced) continue;

    // A refspec can be "src:dst" (push local src to remote dst) or just "branch" (same name on
    // both sides). No refspec at all means git pushes whatever branch is currently checked out.
    let targetBranch: string | null;
    if (parsed.refspec) {
      const colonIndex = parsed.refspec.indexOf(":");
      targetBranch = colonIndex === -1 ? parsed.refspec : parsed.refspec.slice(colonIndex + 1) || null;
    } else {
      targetBranch = await getCurrentBranch(cwd);
    }
    if (!targetBranch) continue;

    const protectedBranch = await resolveProtectedBranch(cwd, await getCurrentBranch(cwd));
    if (protectedBranch && targetBranch === protectedBranch) {
      return (
        `Refused: force-push to ${targetBranch}, this repo's protected branch, is blocked. ` +
        "Force-push a different branch, or do this one yourself if it's really what you want."
      );
    }
  }
  return null;
}

/** Read live (not cached at import time) so it stays toggleable/testable within one process. */
export function tripwiresEnabled(): boolean {
  return process.env.MINI_BASH_TRIPWIRES !== "0";
}

/** Returns a refusal message if `command` matches a known-destructive pattern, else null. */
export async function checkTripwire(command: string, cwd: string): Promise<string | null> {
  for (const sub of splitCommands(command)) {
    if (isRootWipe(sub)) {
      return (
        "Refused: this looks like it would recursively delete / or your home directory. " +
        "If you meant a specific path, use that instead."
      );
    }
  }
  if (CURL_SUDO_PIPE.test(command)) {
    return (
      "Refused: piping a remote script into a root shell (curl/wget | sudo sh) is blocked. " +
      "Download it and inspect the contents first, or run it without sudo if that's sufficient."
    );
  }
  return checkGitForcePush(command, cwd);
}
