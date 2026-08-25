// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { isAbsolute, relative, resolve } from "node:path";

export type PathGuardResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Resolves `requestedPath` against `root` and confirms it doesn't escape it.
 * Guards against a model-supplied `../../.ssh/id_rsa` or an absolute
 * `/etc/passwd` reaching outside the project directory. Doesn't (and can't,
 * without a real sandbox) cover symlinks planted inside root pointing
 * outside it, or anything reached indirectly through the bash tool.
 */
export function resolveInRoot(root: string, requestedPath: string): PathGuardResult {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, requestedPath);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return { ok: true, path: resolvedPath };
  }
  return { ok: false, error: `path escapes the project directory: ${requestedPath}` };
}
