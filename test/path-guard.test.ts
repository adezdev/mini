import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
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

let realDir: string;
let outsideDir: string;

before(async () => {
  const base = await mkdtemp(join(tmpdir(), "mini-path-guard-test-"));
  realDir = join(base, "project");
  outsideDir = join(base, "outside");
  await mkdir(realDir);
  await mkdir(outsideDir);
  await writeFile(join(outsideDir, "secret.txt"), "top secret");
  await symlink(outsideDir, join(realDir, "escape-link"));
});

after(async () => {
  await rm(realDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

test("rejects a symlink inside root pointing outside it", () => {
  const result = resolveInRoot(realDir, "escape-link/secret.txt");
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /escapes the project directory/);
});

test("allows a symlink inside root pointing to another spot inside root", async () => {
  await mkdir(join(realDir, "inner"));
  await symlink(join(realDir, "inner"), join(realDir, "inner-link"));
  const result = resolveInRoot(realDir, "inner-link/file.txt");
  assert.ok(result.ok);
});

test("allows a write target that doesn't exist yet under a real root", () => {
  const result = resolveInRoot(realDir, "new-file.txt");
  assert.ok(result.ok);
});
