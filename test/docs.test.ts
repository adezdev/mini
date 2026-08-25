import assert from "node:assert/strict";
import { test } from "node:test";
import { docsTool } from "../src/tools/docs.js";

test("lists topics when called with no topic", async () => {
  const result = await docsTool.execute({}, "/irrelevant/cwd");
  assert.ok(!result.isError);
  assert.match(result.content, /getting-started/);
  assert.match(result.content, /guardrails/);
  assert.match(result.content, /architecture/);
});

test("returns a doc's full content for a valid topic", async () => {
  const result = await docsTool.execute({ topic: "guardrails" }, "/irrelevant/cwd");
  assert.ok(!result.isError);
  assert.match(result.content, /# Guardrails/);
  assert.match(result.content, /Checkpointing/);
});

test("is case/spacing tolerant on the topic key", async () => {
  const result = await docsTool.execute({ topic: "Repl Commands" }, "/irrelevant/cwd");
  assert.ok(!result.isError);
  assert.match(result.content, /# REPL Commands/);
});

test("reports an error and re-lists topics for an unknown topic", async () => {
  const result = await docsTool.execute({ topic: "nonexistent" }, "/irrelevant/cwd");
  assert.equal(result.isError, true);
  assert.match(result.content, /No doc for/);
  assert.match(result.content, /getting-started/);
});

test("ignores cwd entirely — same result regardless of what's passed", async () => {
  const a = await docsTool.execute({ topic: "tools" }, "/some/project");
  const b = await docsTool.execute({ topic: "tools" }, "/a/totally/different/place");
  assert.equal(a.content, b.content);
});
