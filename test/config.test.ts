import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ConfigError, DEFAULT_MAX_TURNS, DEFAULT_MODEL, loadConfig } from "../src/config.js";

const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.MINI_MODEL;
const originalMaxTurns = process.env.MINI_MAX_TURNS;
const originalEffort = process.env.MINI_EFFORT;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.MINI_MODEL;
  else process.env.MINI_MODEL = originalModel;
  if (originalMaxTurns === undefined) delete process.env.MINI_MAX_TURNS;
  else process.env.MINI_MAX_TURNS = originalMaxTurns;
  if (originalEffort === undefined) delete process.env.MINI_EFFORT;
  else process.env.MINI_EFFORT = originalEffort;
});

test("throws a ConfigError when OPENROUTER_API_KEY is not set", () => {
  delete process.env.OPENROUTER_API_KEY;
  assert.throws(() => loadConfig(), ConfigError);
});

test("uses the default model when no override or env var is set", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  delete process.env.MINI_MODEL;
  const config = loadConfig();
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(config.apiKey, "sk-test");
  assert.equal(config.cwd, process.cwd());
});

test("MINI_MODEL env var overrides the default model", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.MINI_MODEL = "vendor/env-model";
  const config = loadConfig();
  assert.equal(config.model, "vendor/env-model");
});

test("an explicit modelOverride argument wins over MINI_MODEL", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.MINI_MODEL = "vendor/env-model";
  const config = loadConfig("vendor/explicit-model");
  assert.equal(config.model, "vendor/explicit-model");
});

test("uses the default max turns when MINI_MAX_TURNS is not set", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  delete process.env.MINI_MAX_TURNS;
  const config = loadConfig();
  assert.equal(config.maxTurns, DEFAULT_MAX_TURNS);
});

test("MINI_MAX_TURNS env var overrides the default turn cap", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.MINI_MAX_TURNS = "100";
  const config = loadConfig();
  assert.equal(config.maxTurns, 100);
});

test("an invalid MINI_MAX_TURNS falls back to the default rather than NaN/0", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  for (const bad of ["not-a-number", "0", "-5"]) {
    process.env.MINI_MAX_TURNS = bad;
    assert.equal(loadConfig().maxTurns, DEFAULT_MAX_TURNS);
  }
});

test("effort is unset by default", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  delete process.env.MINI_EFFORT;
  assert.equal(loadConfig().effort, undefined);
});

test("MINI_EFFORT sets the default effort level, case-insensitively", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.MINI_EFFORT = "HIGH";
  assert.equal(loadConfig().effort, "high");
});

test("an invalid MINI_EFFORT is ignored rather than passed through", () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  process.env.MINI_EFFORT = "extreme";
  assert.equal(loadConfig().effort, undefined);
});
