import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli-args.js";

test("defaults: no flags", () => {
  assert.deepEqual(parseArgs([]), { listSessions: false, help: false });
});

test("--model captures the following value", () => {
  assert.equal(parseArgs(["--model", "vendor/model"]).model, "vendor/model");
});

test("-p and --print are equivalent", () => {
  assert.equal(parseArgs(["-p", "hello"]).print, "hello");
  assert.equal(parseArgs(["--print", "hello"]).print, "hello");
});

test("--resume captures a session id", () => {
  assert.equal(parseArgs(["--resume", "abc-123"]).resume, "abc-123");
});

test("--list-sessions and --help are boolean flags", () => {
  assert.equal(parseArgs(["--list-sessions"]).listSessions, true);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("a bare positional argument is shorthand for --print", () => {
  assert.equal(parseArgs(["do the thing"]).print, "do the thing");
});

test("an explicit --print flag takes precedence over a later bare positional", () => {
  const args = parseArgs(["--print", "explicit", "ignored positional"]);
  assert.equal(args.print, "explicit");
});

test("combines multiple flags", () => {
  const args = parseArgs(["--model", "m", "--resume", "s1"]);
  assert.deepEqual(args, { model: "m", resume: "s1", listSessions: false, help: false });
});
