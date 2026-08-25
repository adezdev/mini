import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolCallAccumulator } from "../src/llm/tool-call-accumulator.js";

test("accumulates a single tool call split across many argument fragments", () => {
  const acc = new ToolCallAccumulator();
  acc.addDelta({ index: 0, id: "call_1", function: { name: "read", arguments: "" } });
  acc.addDelta({ index: 0, function: { arguments: '{"path":' } });
  acc.addDelta({ index: 0, function: { arguments: '"src/cli.ts"}' } });

  const result = acc.finalize();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "call_1");
  assert.equal(result[0].name, "read");
  assert.deepEqual(result[0].args, { path: "src/cli.ts" });
  assert.equal(result[0].malformed, false);
});

test("accumulates parallel tool calls keyed by index, not id", () => {
  const acc = new ToolCallAccumulator();
  acc.addDelta({ index: 0, id: "call_a", function: { name: "ls", arguments: "{}" } });
  acc.addDelta({ index: 1, id: "call_b", function: { name: "read", arguments: '{"path":"x"}' } });
  acc.addDelta({ index: 0, function: { arguments: "" } });

  const result = acc.finalize();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "call_a");
  assert.equal(result[0].name, "ls");
  assert.deepEqual(result[0].args, {});
  assert.equal(result[1].id, "call_b");
  assert.equal(result[1].name, "read");
  assert.deepEqual(result[1].args, { path: "x" });
});

test("marks unparsable (truncated) arguments as malformed instead of throwing", () => {
  const acc = new ToolCallAccumulator();
  acc.addDelta({ index: 0, id: "call_1", function: { name: "write", arguments: '{"path":"x","content":"abc' } });

  const result = acc.finalize();
  assert.equal(result.length, 1);
  assert.equal(result[0].malformed, true);
});

test("isEmpty reflects whether any tool-call deltas were seen", () => {
  const acc = new ToolCallAccumulator();
  assert.equal(acc.isEmpty(), true);
  acc.addDelta({ index: 0, id: "call_1", function: { name: "ls", arguments: "{}" } });
  assert.equal(acc.isEmpty(), false);
});
