// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type PathGuardResult = { ok: true; path: string } | { ok: false; error: string };

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

// realpathSync throws on a path that doesn't exist yet (e.g. a write's
// target file), so walk up to the nearest ancestor that does exist and
// resolve that instead. Returns null if nothing on the chain exists, which
// only happens for roots that aren't real filesystem paths (tests).
function realExistingAncestor(path: string): string | null {
  let current = path;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * Resolves `requestedPath` against `root` and confirms it doesn't escape it.
 * Guards against a model-supplied `../../.ssh/id_rsa` or an absolute
 * `/etc/passwd` reaching outside the project directory, and against a
 * symlink planted inside root pointing outside it. Doesn't (and can't,
 * without a real sandbox) cover anything reached indirectly through the
 * bash tool.
 */
export function resolveInRoot(root: string, requestedPath: string): PathGuardResult {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, requestedPath);
  if (escapes(resolvedRoot, resolvedPath)) {
    return { ok: false, error: `path escapes the project directory: ${requestedPath}` };
  }

  const realRoot = realExistingAncestor(resolvedRoot);
  const realTarget = realExistingAncestor(resolvedPath);
  if (realRoot && realTarget && escapes(realRoot, realTarget)) {
    return { ok: false, error: `path escapes the project directory: ${requestedPath}` };
  }

  return { ok: true, path: resolvedPath };
}
