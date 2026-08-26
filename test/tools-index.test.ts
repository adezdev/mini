import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allTools, getTools, toolRegistry } from "../src/tools/index.js";

test("allTools registers exactly the eight built-in tools", () => {
  assert.deepEqual(allTools.map((t) => t.name).sort(), ["bash", "docs", "edit", "find", "grep", "ls", "read", "write"]);
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

test("getTools with no .mini/tools/ returns just the built-ins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mini-gettools-test-"));
  try {
    const { tools, errors } = await getTools(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      tools.map((t) => t.name),
      allTools.map((t) => t.name),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getTools merges in dynamic tools from .mini/tools/", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mini-gettools-test-"));
  try {
    await mkdir(join(dir, ".mini", "tools"), { recursive: true });
    await writeFile(
      join(dir, ".mini", "tools", "extra.ts"),
      `export default {
        name: "extra-test",
        description: "An extra tool.",
        parameters: { type: "object", properties: {} },
        async execute() { return { content: "ok" }; },
      };`,
    );

    const { tools, errors } = await getTools(dir);
    assert.deepEqual(errors, []);
    assert.equal(tools.length, allTools.length + 1);
    assert.ok(tools.some((t) => t.name === "extra-test"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
