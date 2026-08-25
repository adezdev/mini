// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

const MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface ModelInfo {
  id: string;
  name: string;
  free: boolean;
  supportsTools: boolean;
  contextLength: number;
  /** USD per 1M prompt tokens, if paid; null if variable/per-request pricing. */
  promptPricePerM: number | null;
  /** USD per 1M completion tokens, if paid; null if variable/per-request pricing. */
  completionPricePerM: number | null;
}

interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    context_length?: number;
    supported_parameters?: string[];
    pricing?: { prompt?: string; completion?: string };
  }>;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(MODELS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch model list (${response.status})`);
  }
  const body = (await response.json()) as OpenRouterModelsResponse;

  return body.data.map((m) => {
    // Some models (e.g. openrouter/auto) report a negative sentinel for
    // "variable, resolved per-request" pricing instead of a real per-token cost.
    const rawPromptPrice = Number(m.pricing?.prompt ?? "0");
    const promptPrice = rawPromptPrice < 0 ? null : rawPromptPrice;
    const rawCompletionPrice = Number(m.pricing?.completion ?? "0");
    const completionPrice = rawCompletionPrice < 0 ? null : rawCompletionPrice;
    return {
      id: m.id,
      name: m.name ?? m.id,
      free: m.id.endsWith(":free") || promptPrice === 0,
      supportsTools: (m.supported_parameters ?? []).includes("tools"),
      contextLength: m.context_length ?? 0,
      promptPricePerM: promptPrice === null ? null : promptPrice * 1_000_000,
      completionPricePerM: completionPrice === null ? null : completionPrice * 1_000_000,
    };
  });
}

/** Tool-capable models, free ones first, then cheapest-to-most-expensive. */
export function rankForPicker(models: ModelInfo[]): ModelInfo[] {
  return models
    .filter((m) => m.supportsTools)
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return (a.promptPricePerM ?? Infinity) - (b.promptPricePerM ?? Infinity);
    });
}

export function formatModelLine(m: ModelInfo): string {
  const price = m.free
    ? "free"
    : m.promptPricePerM === null
      ? "variable pricing"
      : `$${m.promptPricePerM.toFixed(2)}/1M tok`;
  const ctx = m.contextLength > 0 ? `${Math.round(m.contextLength / 1000)}k ctx` : "";
  return `${m.id}  (${[price, ctx].filter(Boolean).join(", ")})`;
}
