# CLI Reference

## Usage

```
mini                          Start an interactive session
mini -p "<prompt>"            Run one prompt and exit
mini --resume <sessionId>     Resume a previous session (interactive)
mini --model <id>             Override the model for this run
mini --list-sessions          List saved sessions for this directory
mini --help                   Show usage
mini "<prompt>"               Shorthand for -p "<prompt>"
```

## Flags

| Flag | Effect |
| --- | --- |
| `-p "<prompt>"` | One-shot mode: run this prompt to completion, print the result, exit. No REPL. |
| `--resume <sessionId>` | Reload a saved session's message history and continue it (interactive unless combined with `-p`). |
| `--model <id>` | Use this OpenRouter model id for the session, overriding `MINI_MODEL`/the default. |
| `--list-sessions` | Print saved session ids and creation times for the current directory, then exit. |
| `--help` | Print the usage summary and exit. |

Sessions are scoped to the directory mini was run from — `--list-sessions`
and `--resume` only see sessions created in that same directory (stored
under `.mini/sessions/`, see [architecture.md](architecture.md)).

## Environment variables

| Variable | Effect |
| --- | --- |
| `OPENROUTER_API_KEY` | Required. Get one at https://openrouter.ai/keys. |
| `MINI_MODEL` | Default model id, used when `--model` isn't passed. Falls back to a free OpenRouter model if unset. |
| `MINI_MAX_TURNS` | Raise the agent loop's 30-turn safety cap for a single user turn (see [guardrails.md](guardrails.md#turn-cap)). |
| `MINI_SELF_CHECK=0` | Disable the automatic self-check pass that follows a turn where mini changed files. See [guardrails.md](guardrails.md#self-check). |
| `MINI_BASH_TRIPWIRES=0` | Disable the bash deny-list for unambiguously destructive commands. See [guardrails.md](guardrails.md#bash-tripwires). |
| `MINI_CONTEXT_TRIM=0` | Disable auto-collapsing of stale tool output in old turns. See [guardrails.md](guardrails.md#stale-tool-output-trimming). |

## Model selection

Default model: `nvidia/nemotron-3-super-120b-a12b:free`. Override at startup
with `--model <id>` or `MINI_MODEL`.

To switch mid-session, use `/model` in the REPL — see
[repl-commands.md](repl-commands.md#model).

## Project instructions

Drop a `MINI.md`, `CLAUDE.md`, or `AGENTS.md` in your project root and mini
injects it into the system prompt as project-specific context. First match
wins, checked in that order — mini's own native file first, then this
project's actual convention, then the generic cross-tool fallback. Only one
file is ever loaded, never merged.

`/refine` (see [repl-commands.md](repl-commands.md#refine)) always targets
whichever file this resolution actually finds, never a hardcoded name.
