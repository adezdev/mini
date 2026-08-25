import assert from "node:assert/strict";
import { test } from "node:test";
import { formatModelLine, type ModelInfo, rankForPicker } from "../src/models.js";

function model(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    id: "vendor/model",
    name: "Model",
    free: false,
    supportsTools: true,
    contextLength: 100_000,
    promptPricePerM: 1,
    completionPricePerM: 2,
    ...overrides,
  };
}

test("rankForPicker: drops models without tool-calling support", () => {
  const models = [model({ id: "a", supportsTools: true }), model({ id: "b", supportsTools: false })];
  const ranked = rankForPicker(models);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["a"],
  );
});

test("rankForPicker: free models sort before paid models regardless of price", () => {
  const models = [
    model({ id: "expensive-free", free: true, promptPricePerM: 0 }),
    model({ id: "cheap-paid", free: false, promptPricePerM: 0.01 }),
  ];
  const ranked = rankForPicker(models);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["expensive-free", "cheap-paid"],
  );
});

test("rankForPicker: paid models sort cheapest first", () => {
  const models = [
    model({ id: "pricey", free: false, promptPricePerM: 5 }),
    model({ id: "cheap", free: false, promptPricePerM: 0.5 }),
  ];
  const ranked = rankForPicker(models);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["cheap", "pricey"],
  );
});

test("rankForPicker: variable (null) pricing sorts after known prices", () => {
  const models = [
    model({ id: "variable", free: false, promptPricePerM: null }),
    model({ id: "known", free: false, promptPricePerM: 2 }),
  ];
  const ranked = rankForPicker(models);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["known", "variable"],
  );
});

test("formatModelLine: shows 'free' for free models", () => {
  const line = formatModelLine(model({ id: "x", free: true, promptPricePerM: 0, contextLength: 262_144 }));
  assert.match(line, /^x\s+\(free, 262k ctx\)$/);
});

test("formatModelLine: shows price per 1M tokens for paid models", () => {
  const line = formatModelLine(model({ id: "x", free: false, promptPricePerM: 3, contextLength: 128_000 }));
  assert.match(line, /\$3\.00\/1M tok/);
});

test("formatModelLine: shows 'variable pricing' when price is null", () => {
  const line = formatModelLine(model({ id: "x", free: false, promptPricePerM: null }));
  assert.match(line, /variable pricing/);
});
