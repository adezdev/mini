import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fetchModels } from "../src/models.js";

const realFetch = globalThis.fetch;

function mockFetchOnce(response: Response): void {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

after(() => {
  globalThis.fetch = realFetch;
});

test("maps OpenRouter's model list into ModelInfo, including tool support and pricing", async () => {
  mockFetchOnce(
    Response.json({
      data: [
        {
          id: "vendor/free-model:free",
          name: "Free Model",
          context_length: 128_000,
          supported_parameters: ["tools", "temperature"],
          pricing: { prompt: "0", completion: "0" },
        },
        {
          id: "vendor/paid-model",
          name: "Paid Model",
          context_length: 64_000,
          supported_parameters: [],
          pricing: { prompt: "0.000003", completion: "0.000006" },
        },
      ],
    }),
  );

  const models = await fetchModels();

  assert.deepEqual(models[0], {
    id: "vendor/free-model:free",
    name: "Free Model",
    free: true,
    supportsTools: true,
    contextLength: 128_000,
    promptPricePerM: 0,
    completionPricePerM: 0,
  });
  assert.deepEqual(models[1], {
    id: "vendor/paid-model",
    name: "Paid Model",
    free: false,
    supportsTools: false,
    contextLength: 64_000,
    promptPricePerM: 3,
    completionPricePerM: 6,
  });
});

test("treats a negative pricing sentinel (variable/per-request pricing) as null", async () => {
  mockFetchOnce(
    Response.json({
      data: [
        {
          id: "openrouter/auto",
          supported_parameters: ["tools"],
          pricing: { prompt: "-1" },
        },
      ],
    }),
  );

  const [model] = await fetchModels();
  assert.equal(model.promptPricePerM, null);
  assert.equal(model.free, false);
});

test("falls back to the model id as its name when 'name' is absent", async () => {
  mockFetchOnce(Response.json({ data: [{ id: "vendor/unnamed", pricing: { prompt: "0" } }] }));
  const [model] = await fetchModels();
  assert.equal(model.name, "vendor/unnamed");
});

test("throws a descriptive error when the response is not ok", async () => {
  mockFetchOnce(new Response("", { status: 503 }));
  await assert.rejects(() => fetchModels(), /Failed to fetch model list \(503\)/);
});
