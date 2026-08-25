#!/usr/bin/env bun
// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { parseArgs } from "./cli-args.js";
import { type Config, ConfigError, loadConfig } from "./config.js";
import { runOneShot, startRepl } from "./repl.js";
import { listSessions, Session } from "./session/jsonl.js";

function printHelp(): void {
  console.log(`mini: a from-scratch, zero-dependency coding agent CLI (OpenRouter only)

Usage:
  mini                          Start an interactive session
  mini -p "<prompt>"            Run one prompt and exit
  mini --resume <sessionId>     Resume a previous session (interactive)
  mini --model <id>             Override the model (default: from MINI_MODEL or a free OpenRouter model)
  mini --list-sessions          List saved sessions for this directory
  mini --help                   Show this help

In an interactive session:
  /help                          List interactive commands
  /model                         Pick a model from a live OpenRouter list
  /model <id>                    Switch to a model id directly
  /tools                         List available tools
  /system                        Print the current system prompt
  /cost                          Show cumulative token usage and estimated $ cost
  /sessions                      List saved sessions for this directory
  /resume <id>                   Resume a saved session (replaces current context)
  /clear                         Reset the conversation context
  /compact                       Summarize history so far to free up context
  /refine                        Propose CLAUDE.md updates from this session, with a diff to confirm
  /exit                          Quit

Environment:
  OPENROUTER_API_KEY   required, get one at https://openrouter.ai/keys
  MINI_MODEL            optional default model override
  MINI_SELF_CHECK=0     disable the automatic self-check pass after file changes
  MINI_BASH_TRIPWIRES=0 disable the bash deny-list for unambiguously destructive commands
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  let config: Config;
  try {
    config = loadConfig(args.model);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (args.listSessions) {
    const sessions = await listSessions(config.cwd);
    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }
    for (const s of sessions) {
      console.log(`${s.id}  ${s.createdAt}`);
    }
    return;
  }

  if (args.resume) {
    const { session, messages } = await Session.resume(config.cwd, args.resume);
    if (args.print) {
      await runOneShot(config, args.print, session, messages);
      return;
    }
    await startRepl(config, messages, session);
    return;
  }

  if (args.print) {
    const session = await Session.create(config.cwd);
    await runOneShot(config, args.print, session);
    return;
  }

  const session = await Session.create(config.cwd);
  await startRepl(config, [], session);
}

main().catch((err) => {
  console.error(`\x1b[31mFatal error: ${(err as Error).message}\x1b[0m`);
  process.exitCode = 1;
});
