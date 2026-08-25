// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { readFile, writeFile } from "node:fs/promises";
import type { Interface } from "node:readline/promises";
import { createInterface } from "node:readline/promises";
import { runAgentLoop } from "./agent/loop.js";
import type { Message } from "./agent/types.js";
import { type CheckpointState, commitCheckpointIfDirty, initCheckpointing } from "./checkpoint.js";
import type { Config } from "./config.js";
import { fetchModels, formatModelLine, type ModelInfo, rankForPicker } from "./models.js";
import { computeRefinement } from "./refine.js";
import { listSessions, Session } from "./session/jsonl.js";
import { buildSystemPrompt, findProjectInstructionsPath } from "./system-prompt.js";
import { allTools } from "./tools/index.js";

function printCheckpointInit(state: CheckpointState): void {
  if (state.reason === "new-branch") {
    const from = state.originalBranch ? `was on ${state.originalBranch}` : "was on a detached HEAD";
    console.log(`\x1b[2mCheckpointing enabled — created and switched to ${state.branch} (${from}).\x1b[0m\n`);
  } else if (state.reason === "in-place") {
    console.log(`\x1b[2mCheckpointing enabled on ${state.branch}.\x1b[0m\n`);
  } else if (state.reason === "dirty") {
    console.log("\x1b[33mUncommitted changes present — checkpointing disabled this session.\x1b[0m\n");
  }
}

function printCheckpointSummary(state: CheckpointState): void {
  if (state.enabled && state.commitCount > 0) {
    console.log(`\x1b[2mCheckpointing: ${state.commitCount} commit(s) on ${state.branch}.\x1b[0m\n`);
  }
}

const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);
function selfCheckEnabled(): boolean {
  return process.env.MINI_SELF_CHECK !== "0";
}
const SELF_CHECK_PROMPT =
  "[auto self-check] You changed files in your last turn. Verify correctness — run this " +
  "project's own checks (tests, lint, typecheck, build — whatever this project actually uses) " +
  "and fix anything broken before finishing. If there's no obvious way to check, say so briefly.";

/**
 * Checkpointing is decided once at session start, which misses the common "new project" case:
 * the directory wasn't a git repo yet, so it's disabled — but the model might `git init` it
 * moments later as part of the very task it was asked to do. Retried before every commit
 * attempt (cheap: a `git rev-parse` that fails fast for a non-repo) so it turns on the moment
 * the directory actually becomes checkpoint-able, without waiting for a new session.
 */
async function maybeActivateCheckpointing(
  config: Config,
  session: Session,
  checkpoint: CheckpointState,
): Promise<void> {
  if (checkpoint.enabled) return;
  const refreshed = await initCheckpointing(config.cwd, session.id, { requireCleanStart: false });
  if (!refreshed.enabled) return;
  Object.assign(checkpoint, refreshed);
  printCheckpointInit(checkpoint);
}

/** Runs one prompt through the agent loop, persists it, and checkpoints. Returns whether a tool call changed files. */
async function runPass(
  config: Config,
  session: Session,
  messages: Message[],
  promptText: string,
  checkpoint: CheckpointState,
  onUsage?: (promptTokens: number, completionTokens: number) => void,
): Promise<boolean> {
  const userMessage: Message = { role: "user", content: promptText };
  messages.push(userMessage);
  await session.appendMessage(userMessage);

  const beforeLength = messages.length;
  let toolInFlight = false;
  let mutated = false;

  await runAgentLoop({
    apiKey: config.apiKey,
    model: config.model,
    messages,
    tools: allTools,
    cwd: config.cwd,
    maxTurns: config.maxTurns,
    onEvent(event) {
      switch (event.type) {
        case "text_delta":
          process.stdout.write(event.text);
          break;
        case "tool_call_start":
          toolInFlight = true;
          process.stdout.write(`\n\x1b[2m› ${event.name}(${summarizeArgs(event.args)})\x1b[0m\n`);
          break;
        case "tool_call_end":
          toolInFlight = false;
          if (MUTATING_TOOLS.has(event.name) && !event.isError) mutated = true;
          process.stdout.write(formatToolResult(event.content, event.isError));
          break;
        case "turn_end":
          if (!toolInFlight) process.stdout.write("\n");
          break;
        case "usage":
          onUsage?.(event.promptTokens, event.completionTokens);
          break;
      }
    },
  });

  for (let i = beforeLength; i < messages.length; i++) {
    await session.appendMessage(messages[i]);
  }

  await maybeActivateCheckpointing(config, session, checkpoint);
  const result = await commitCheckpointIfDirty(checkpoint, promptText);
  if (result.error) {
    console.error(`\x1b[31mCheckpoint commit failed: ${result.error}\x1b[0m\n`);
  }

  return mutated;
}

async function runTurn(
  config: Config,
  session: Session,
  messages: Message[],
  userInput: string,
  checkpoint: CheckpointState,
  onUsage?: (promptTokens: number, completionTokens: number) => void,
): Promise<void> {
  const mutated = await runPass(config, session, messages, userInput, checkpoint, onUsage);

  if (mutated && selfCheckEnabled()) {
    console.log("\n\x1b[2m› auto self-check: verifying the changes above…\x1b[0m");
    await runPass(config, session, messages, SELF_CHECK_PROMPT, checkpoint, onUsage);
  }
}

/** Summarizes with no tools available, so the model can't go re-reading files mid-summary. */
async function summarizeMessages(config: Config, messages: Message[]): Promise<string> {
  const scratch: Message[] = [
    ...messages,
    {
      role: "user",
      content:
        "Summarize this conversation so far in a concise paragraph, preserving important facts, " +
        "decisions, and file/code context needed to continue the work. Output only the summary text.",
    },
  ];
  let summary = "";
  await runAgentLoop({
    apiKey: config.apiKey,
    model: config.model,
    messages: scratch,
    tools: [],
    maxTurns: config.maxTurns,
    onEvent(event) {
      if (event.type === "text_delta") summary += event.text;
    },
  });
  return summary.trim();
}

let modelInfoCache: ModelInfo[] | null = null;

/** Test-only: clears the cached model list so pricing lookups re-fetch. */
export function __resetModelPricingCacheForTests(): void {
  modelInfoCache = null;
}

async function lookupModelPricing(id: string): Promise<ModelInfo | undefined> {
  if (!modelInfoCache) {
    try {
      modelInfoCache = await fetchModels();
    } catch {
      return undefined;
    }
  }
  return modelInfoCache.find((m) => m.id === id);
}

const CONTEXT_WARNING_THRESHOLD = 0.8;

/**
 * mini has no automatic history pruning, so a long session can walk right up
 * to the model's context limit and get a provider error mid-task. This warns
 * once a turn's prompt size crosses a threshold, using the same cached model
 * list /cost already fetches (silently no-ops if that fetch fails).
 */
async function checkContextUsage(config: Config, promptTokens: number): Promise<string | null> {
  if (promptTokens <= 0) return null;
  const info = await lookupModelPricing(config.model);
  if (!info || info.contextLength <= 0) return null;
  const ratio = promptTokens / info.contextLength;
  if (ratio < CONTEXT_WARNING_THRESHOLD) return null;
  return `\x1b[33mContext usage at ${Math.round(ratio * 100)}% (${promptTokens}/${info.contextLength} tokens) — consider /compact.\x1b[0m\n`;
}

async function printCost(config: Config, usage: { promptTokens: number; completionTokens: number }): Promise<void> {
  const total = usage.promptTokens + usage.completionTokens;
  console.log(
    `\n\x1b[2mSession usage: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${total} tokens\x1b[0m`,
  );
  const info = await lookupModelPricing(config.model);
  if (info && (info.promptPricePerM !== null || info.completionPricePerM !== null)) {
    const promptCost = info.promptPricePerM ? (usage.promptTokens / 1_000_000) * info.promptPricePerM : 0;
    const completionCost = info.completionPricePerM
      ? (usage.completionTokens / 1_000_000) * info.completionPricePerM
      : 0;
    console.log(`\x1b[2mEstimated cost for ${config.model}: $${(promptCost + completionCost).toFixed(4)}\x1b[0m\n`);
  } else {
    console.log(`\x1b[2m(pricing unavailable for ${config.model})\x1b[0m\n`);
  }
}

const REPL_HELP = `
Commands:
  /help              Show this list
  /model             Pick a model from a live OpenRouter list
  /model <id>        Switch to a model id directly
  /tools             List available tools
  /system            Print the current system prompt
  /cost              Show cumulative token usage and estimated $ cost
  /sessions          List saved sessions for this directory
  /resume <id>       Resume a saved session (replaces current context)
  /clear             Reset the conversation context (keeps the session log)
  /compact           Summarize the conversation so far to free up context
  /refine            Propose project-instructions updates based on this session, with a diff to confirm
  /exit, /quit       Quit
`;

function summarizeArgs(args: unknown): string {
  const json = JSON.stringify(args);
  if (!json) return "";
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

function formatToolResult(content: string, isError: boolean): string {
  const lines = content.split("\n");
  const preview = lines.slice(0, 12).join("\n");
  const trailer = lines.length > 12 ? `\n\x1b[2m… (${lines.length - 12} more lines)\x1b[0m` : "";
  const color = isError ? "\x1b[31m" : "\x1b[2m";
  return `${color}${preview}${trailer}\x1b[0m\n`;
}

const PICKER_LIMIT = 20;

/** OpenRouter model ids are always `vendor/name` shaped — never a leading slash. */
function looksLikeModelId(value: string): boolean {
  return !value.startsWith("/");
}

async function pickModel(config: Config, rl: Interface, requestedId?: string): Promise<void> {
  if (requestedId) {
    if (!looksLikeModelId(requestedId)) {
      console.log(`\x1b[31m"${requestedId}" doesn't look like a model id (did you mean a REPL command?)\x1b[0m\n`);
      return;
    }
    config.model = requestedId;
    console.log(`\x1b[2mModel set to ${config.model}\x1b[0m\n`);
    return;
  }

  console.log("\x1b[2mFetching available models from OpenRouter…\x1b[0m");
  let models: ModelInfo[];
  try {
    models = rankForPicker(await fetchModels());
  } catch (err) {
    console.error(`\x1b[31mCould not fetch model list: ${(err as Error).message}\x1b[0m`);
    console.error("You can still set one directly: /model <id>\n");
    return;
  }

  const shown = models.slice(0, PICKER_LIMIT);
  if (shown.length === 0) {
    console.log("No tool-capable models found.\n");
    return;
  }

  console.log(`\nTool-capable models (free first, then cheapest):\n`);
  shown.forEach((m, i) => {
    const marker = m.id === config.model ? " *" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${formatModelLine(m)}${marker}`);
  });
  console.log("\nEnter a number, or a model id directly, or blank to cancel.");

  let answer: string;
  try {
    answer = (await rl.question("model> ")).trim();
  } catch {
    console.log("Cancelled.\n");
    return;
  }
  if (!answer) {
    console.log("Cancelled.\n");
    return;
  }

  const asIndex = Number(answer);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= shown.length) {
    config.model = shown[asIndex - 1].id;
  } else if (looksLikeModelId(answer)) {
    config.model = answer;
  } else {
    console.log(
      `\x1b[31m"${answer}" doesn't look like a model id (did you mean a REPL command?) — cancelled.\x1b[0m\n`,
    );
    return;
  }
  console.log(`\x1b[2mModel set to ${config.model}\x1b[0m\n`);
}

/**
 * Runs the interactive command loop against an already-created readline
 * `Interface`. Split out from `startRepl` so tests can drive it with an
 * in-memory input/output pair instead of real stdin/stdout.
 */
export async function runReplLoop(config: Config, messages: Message[], session: Session, rl: Interface): Promise<void> {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let lastPromptTokens = 0;
  let warnedContextFull = false;

  const checkpoint = await initCheckpointing(config.cwd, session.id);
  printCheckpointInit(checkpoint);

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("> ");
      } catch {
        break; // stdin closed (e.g. piped input ran out, or Ctrl+D), exit quietly
      }
      const trimmed = line.trim();
      if (trimmed === "/exit" || trimmed === "/quit") break;
      if (trimmed === "") continue;

      if (trimmed === "/help") {
        console.log(REPL_HELP);
        continue;
      }

      if (trimmed === "/model" || trimmed.startsWith("/model ")) {
        const arg = trimmed.slice("/model".length).trim();
        try {
          await pickModel(config, rl, arg || undefined);
        } catch (err) {
          console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
        }
        continue;
      }

      if (trimmed === "/tools") {
        console.log("");
        for (const t of allTools) console.log(`  ${t.name}: ${t.description}`);
        console.log("");
        continue;
      }

      if (trimmed === "/system") {
        const sys = messages.find((m) => m.role === "system");
        console.log(sys ? `\n${sys.content}\n` : "\n(no system prompt set)\n");
        continue;
      }

      if (trimmed === "/cost") {
        try {
          await printCost(config, { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens });
        } catch (err) {
          console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
        }
        continue;
      }

      if (trimmed === "/sessions") {
        const sessions = await listSessions(config.cwd);
        if (sessions.length === 0) {
          console.log("No sessions found.\n");
        } else {
          console.log("");
          for (const s of sessions) {
            const marker = s.id === session.id ? " *" : "";
            console.log(`  ${s.id}  ${s.createdAt}${marker}`);
          }
          console.log("");
        }
        continue;
      }

      if (trimmed === "/resume" || trimmed.startsWith("/resume ")) {
        const id = trimmed.slice("/resume".length).trim();
        if (!id) {
          console.log("Usage: /resume <sessionId>\n");
          continue;
        }
        try {
          const resumed = await Session.resume(config.cwd, id);
          session = resumed.session;
          messages.length = 0;
          messages.push(...resumed.messages);
          totalPromptTokens = 0;
          totalCompletionTokens = 0;
          console.log(`\x1b[2mResumed session ${session.id} (${messages.length} messages).\x1b[0m\n`);
        } catch (err) {
          console.error(`\x1b[31mCould not resume session ${id}: ${(err as Error).message}\x1b[0m`);
        }
        continue;
      }

      if (trimmed === "/clear") {
        const systemPrompt = await buildSystemPrompt(allTools, config.cwd);
        messages.length = 0;
        messages.push({ role: "system", content: systemPrompt });
        totalPromptTokens = 0;
        totalCompletionTokens = 0;
        lastPromptTokens = 0;
        warnedContextFull = false;
        console.log("\x1b[2mContext cleared.\x1b[0m\n");
        continue;
      }

      if (trimmed === "/compact") {
        console.log("\x1b[2mCompacting conversation history…\x1b[0m");
        try {
          const summary = await summarizeMessages(config, messages);
          const sys = messages.find((m) => m.role === "system");
          messages.length = 0;
          if (sys) messages.push(sys);
          const summaryMessage: Message = { role: "user", content: `Summary of earlier conversation:\n\n${summary}` };
          messages.push(summaryMessage);
          await session.appendMessage(summaryMessage);
          lastPromptTokens = 0;
          warnedContextFull = false;
          console.log(`\x1b[2mHistory compacted (context now ${messages.length} messages).\x1b[0m\n`);
        } catch (err) {
          console.error(`\x1b[31mCompact failed: ${(err as Error).message}\x1b[0m`);
        }
        continue;
      }

      if (trimmed === "/refine") {
        const instructionsPath = await findProjectInstructionsPath(config.cwd);
        if (!instructionsPath) {
          console.log("No AGENTS.md/CLAUDE.md/MINI.md found in this directory — /refine only edits an existing one.\n");
          continue;
        }
        const fileName = instructionsPath.slice(config.cwd.length + 1);
        const instructionsContent = await readFile(instructionsPath, "utf-8");
        console.log(`\x1b[2mReviewing this session for anything worth adding to ${fileName}…\x1b[0m`);
        try {
          const refinement = await computeRefinement(config, messages, instructionsContent);
          if (!refinement) {
            console.log(`Nothing to refine — ${fileName} already covers this session.\n`);
            continue;
          }
          console.log(`\n${refinement.diff}`);
          const answer = (await rl.question(`Apply these changes to ${fileName}? [y/N] `)).trim().toLowerCase();
          if (answer === "y" || answer === "yes") {
            await writeFile(instructionsPath, refinement.newContent, "utf-8");
            console.log(`\x1b[2m${fileName} updated.\x1b[0m\n`);
            await maybeActivateCheckpointing(config, session, checkpoint);
            const result = await commitCheckpointIfDirty(checkpoint, `/refine: ${fileName}`);
            if (result.error) console.error(`\x1b[31mCheckpoint commit failed: ${result.error}\x1b[0m\n`);
          } else {
            console.log("Discarded.\n");
          }
        } catch (err) {
          console.error(`\x1b[31mRefine failed: ${(err as Error).message}\x1b[0m`);
        }
        continue;
      }

      try {
        await runTurn(config, session, messages, trimmed, checkpoint, (p, c) => {
          totalPromptTokens += p;
          totalCompletionTokens += c;
          lastPromptTokens = p;
        });
        if (!warnedContextFull) {
          const warning = await checkContextUsage(config, lastPromptTokens);
          if (warning) {
            warnedContextFull = true;
            console.log(warning);
          }
        }
      } catch (err) {
        console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
      }
    }
  } finally {
    printCheckpointSummary(checkpoint);
    rl.close();
  }
}

export async function startRepl(config: Config, initialMessages: Message[], session: Session): Promise<void> {
  const messages = initialMessages;
  if (messages.length === 0) {
    const systemPrompt = await buildSystemPrompt(allTools, config.cwd);
    const systemMessage: Message = { role: "system", content: systemPrompt };
    messages.push(systemMessage);
    await session.appendMessage(systemMessage);
  }

  console.log(`mini (model: ${config.model}, session: ${session.id})`);
  console.log("Type your request, /help for commands, or /exit to quit.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await runReplLoop(config, messages, session, rl);
}

export async function runOneShot(
  config: Config,
  prompt: string,
  session: Session,
  existingMessages: Message[] = [],
): Promise<void> {
  const messages = existingMessages;
  if (messages.length === 0) {
    const systemPrompt = await buildSystemPrompt(allTools, config.cwd);
    const systemMessage: Message = { role: "system", content: systemPrompt };
    messages.push(systemMessage);
    await session.appendMessage(systemMessage);
  }
  const checkpoint = await initCheckpointing(config.cwd, session.id);
  printCheckpointInit(checkpoint);
  await runTurn(config, session, messages, prompt, checkpoint);
  printCheckpointSummary(checkpoint);
}
