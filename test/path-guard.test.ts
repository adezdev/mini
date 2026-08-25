import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { resolveInRoot } from "../src/tools/path-guard.js";

const root = "/home/user/project";

test("resolves a relative path within root", () => {
  const result = resolveInRoot(root, "src/index.ts");
  assert.ok(result.ok);
  assert.equal(result.path, join(root, "src/index.ts"));
});

test("resolves an absolute path within root", () => {
  const result = resolveInRoot(root, join(root, "src/index.ts"));
  assert.ok(result.ok);
  assert.equal(result.path, join(root, "src/index.ts"));
});

test("resolves the root itself", () => {
  const result = resolveInRoot(root, ".");
  assert.ok(result.ok);
  assert.equal(result.path, root);
});

test("rejects a relative path that escapes root via ..", () => {
  const result = resolveInRoot(root, "../../.ssh/id_rsa");
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /escapes the project directory/);
});

test("rejects an absolute path outside root", () => {
  const result = resolveInRoot(root, "/etc/passwd");
  assert.equal(result.ok, false);
});

test("rejects a sibling directory that shares a prefix with root", () => {
  // Guards against a naive string-prefix check treating /home/user/project-evil
  // as inside /home/user/project.
  const result = resolveInRoot(root, "../project-evil/secret");
  assert.equal(result.ok, false);
});
