// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Last-resort circuit breaker for the bash tool: a small, high-confidence deny-list of
// unambiguously destructive commands. Guards against an honest mistake (a hallucinated bad
// path), not a determined jailbreak trying to obfuscate around it — that needs a real sandbox,
// which is out of scope here. Deliberately not a permission system: no in-band override, since
// a model that could flip a "force: true" flag would just learn to always flip it.

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

/** Read live (not cached at import time) so it stays toggleable/testable within one process. */
export function tripwiresEnabled(): boolean {
  return process.env.MINI_BASH_TRIPWIRES !== "0";
}

/** Returns a refusal message if `command` matches a known-destructive pattern, else null. */
export function checkTripwire(command: string): string | null {
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
  return null;
}
