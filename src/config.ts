// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const DEFAULT_MAX_TURNS = 30;

export interface Config {
  apiKey: string;
  model: string;
  cwd: string;
  maxTurns: number;
}

export class ConfigError extends Error {}

export function loadConfig(modelOverride?: string): Config {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ConfigError(
      "OPENROUTER_API_KEY is not set. Get a key at https://openrouter.ai/keys and export it:\n" +
        "  export OPENROUTER_API_KEY=sk-or-...",
    );
  }
  const model = modelOverride ?? process.env.MINI_MODEL ?? DEFAULT_MODEL;
  const maxTurnsEnv = process.env.MINI_MAX_TURNS ? Number(process.env.MINI_MAX_TURNS) : undefined;
  const maxTurns = maxTurnsEnv && Number.isFinite(maxTurnsEnv) && maxTurnsEnv > 0 ? maxTurnsEnv : DEFAULT_MAX_TURNS;
  return { apiKey, model, cwd: process.cwd(), maxTurns };
}
