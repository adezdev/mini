import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadDynamicTools } from "../src/tools/dynamic.js";

let dir: string;
let toolsDir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mini-dynamic-tools-test-"));
  toolsDir = join(dir, ".mini", "tools");
  await mkdir(toolsDir, { recursive: true });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BUILTINS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls", "docs"]);

test("missing .mini/tools/ returns no tools and no errors", async () => {
  const empty = await mkdtemp(join(tmpdir(), "mini-dynamic-tools-empty-"));
  try {
    const { tools, errors } = await loadDynamicTools(empty, BUILTINS);
    assert.deepEqual(tools, []);
    assert.deepEqual(errors, []);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("loads a valid tool file exported as default", async () => {
  await writeFile(
    join(toolsDir, "echo.ts"),
    `export default {
      name: "echo-test",
      description: "Echoes its input.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      async execute(args) { return { content: args.text }; },
    };`,
  );

  const { tools, errors } = await loadDynamicTools(dir, BUILTINS);
  assert.deepEqual(errors, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "echo-test");
  assert.deepEqual(await tools[0].execute({ text: "hi" }, dir), { content: "hi" });
});

test("loads a valid tool file exported as named 'tool'", async () => {
  await writeFile(
    join(toolsDir, "named.ts"),
    `export const tool = {
      name: "named-test",
      description: "Named export tool.",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "ok" }; },
    };`,
  );

  const { tools, errors } = await loadDynamicTools(dir, BUILTINS);
  assert.deepEqual(errors, []);
  assert.ok(tools.some((t) => t.name === "named-test"));
});

test("skips a file with the wrong shape and reports it", async () => {
  await writeFile(join(toolsDir, "malformed.ts"), `export default { name: "no-execute" };`);

  const { tools, errors } = await loadDynamicTools(dir, BUILTINS);
  assert.ok(!tools.some((t) => t.name === "no-execute"));
  assert.ok(errors.some((e) => e.includes("malformed.ts")));
});

test("skips a file that throws on import and reports it", async () => {
  await writeFile(join(toolsDir, "throws.ts"), `throw new Error("boom");`);

  const { errors } = await loadDynamicTools(dir, BUILTINS);
  assert.ok(errors.some((e) => e.includes("throws.ts") && e.includes("boom")));
});

test("skips a tool whose name collides with a built-in", async () => {
  await writeFile(
    join(toolsDir, "shadow.ts"),
    `export default {
      name: "bash",
      description: "Pretends to be bash.",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "nope" }; },
    };`,
  );

  const { tools, errors } = await loadDynamicTools(dir, BUILTINS);
  assert.ok(!tools.some((t) => t.name === "bash"));
  assert.ok(errors.some((e) => e.includes("shadow.ts") && e.includes("collides with a built-in")));
});

test("re-scanning after an edit picks up the change (mtime cache-bust)", async () => {
  const filePath = join(toolsDir, "versioned.ts");
  await writeFile(
    filePath,
    `export default {
      name: "versioned-test",
      description: "v1",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "v1" }; },
    };`,
  );
  const first = await loadDynamicTools(dir, BUILTINS);
  const firstTool = first.tools.find((t) => t.name === "versioned-test");
  assert.ok(firstTool);
  assert.equal((await firstTool.execute({}, dir)).content, "v1");

  // Bump mtime forward explicitly — some filesystems have coarse mtime resolution and a
  // same-millisecond rewrite wouldn't otherwise prove the cache actually busted.
  await writeFile(
    filePath,
    `export default {
      name: "versioned-test",
      description: "v2",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "v2" }; },
    };`,
  );
  const future = new Date(Date.now() + 60_000);
  await utimes(filePath, future, future);

  const second = await loadDynamicTools(dir, BUILTINS);
  const secondTool = second.tools.find((t) => t.name === "versioned-test");
  assert.ok(secondTool);
  assert.equal((await secondTool.execute({}, dir)).content, "v2");
});
