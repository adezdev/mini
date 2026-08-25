import assert from "node:assert/strict";
import { test } from "node:test";
import { allTools, toolRegistry } from "../src/tools/index.js";

test("allTools registers exactly the seven built-in tools", () => {
  assert.deepEqual(allTools.map((t) => t.name).sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
});

test("toolRegistry defaults to indexing allTools by name", () => {
  const registry = toolRegistry();
  assert.equal(registry.size, allTools.length);
  for (const tool of allTools) {
    assert.equal(registry.get(tool.name), tool);
  }
});

test("toolRegistry can index a custom subset of tools", () => {
  const [ls, read] = allTools.filter((t) => t.name === "ls" || t.name === "read");
  const registry = toolRegistry([ls, read]);
  assert.deepEqual([...registry.keys()].sort(), ["ls", "read"]);
});
