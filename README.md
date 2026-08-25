# mini

[![GitHub](https://img.shields.io/badge/GitHub-adezdev%2Fmini-181717?logo=github)](https://github.com/adezdev/mini)
[![CI](https://github.com/adezdev/mini/actions/workflows/ci.yml/badge.svg)](https://github.com/adezdev/mini/actions/workflows/ci.yml)

A from-scratch, zero-runtime-dependency coding agent CLI, built on [Bun](https://bun.sh):
an agent loop, an interactive REPL, streaming tool calls, and a handful of built-in
tools, talking only to [OpenRouter](https://openrouter.ai).

## Why it's scoped this way

`mini` intentionally keeps just the essential slice a solo developer needs day to day,
not a full agent-runtime platform (multi-provider abstraction, terminal UI framework,
telemetry, session backends, a server/protocol layer):

- **One provider**: OpenRouter only (OpenAI-compatible `/chat/completions`), so you
  can point it at free or cheap models without juggling multiple API keys.
- **Zero runtime dependencies**: only Bun's/Node's standard library (`fetch`,
  `readline`, `child_process`, `fs`). `typescript`/`bun-types` are dev-only, for
  editor support and `tsc --noEmit` type-checking. Bun runs the `.ts` sources
  directly, no build/transpile step needed.
- **Plain-text REPL**, not a differential-render TUI.
- **Seven tools**: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Enough for
  real editing/searching/running-things work.

## Setup

Requires [Bun](https://bun.sh) (`sudo pacman -S bun` on Arch, or see bun.sh/docs/installation).

```bash
bun install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys
```

## Usage

```bash
bun src/cli.ts                        # interactive REPL
bun src/cli.ts -p "list this repo"     # one-shot prompt, no REPL
bun src/cli.ts --model <id>            # override the model for this run
bun src/cli.ts --resume <sessionId>    # resume a saved session
bun src/cli.ts --list-sessions         # list sessions saved in this directory
```

Or link it as a binary: `bun link` then run `mini` directly. To ship a single
self-contained executable (no Bun install required on the target machine), run
`bun run compile`, which produces `dist/mini` (~77MB, includes the Bun runtime).

### Model selection

Default model: `nvidia/nemotron-3-super-120b-a12b:free`. Override at startup with
`--model <id>` or the `MINI_MODEL` env var.

To switch mid-session, use the `/model` command in the REPL:

- `/model`: fetches the current tool-capable model list from OpenRouter, prints it
  (free models first, then cheapest-to-most-expensive), and lets you pick by number
  or type an id directly.
- `/model <id>`: switch straight to a known id, no fetch/prompt.

If you're rate-limited on a free model (OpenRouter's free tier is a shared pool and
gets 429s under load), `/model` is the fastest way to hop to another one.

### Turn cap

The agent loop stops after 30 turns by default to avoid runaway tool-call loops. If a real
task needs more room, raise it with `MINI_MAX_TURNS=<n>`.

### Other REPL commands

- `/help`: list all interactive commands
- `/tools`: list the built-in tools and their descriptions
- `/system`: print the current system prompt (useful for debugging what's sent)
- `/cost`: show cumulative token usage for the session, plus an estimated $ cost
  for the current model (pricing is fetched from OpenRouter on first use and cached)
- `/sessions`: list saved sessions for this directory (same data as `--list-sessions`)
- `/resume <id>`: resume a saved session without restarting the process
- `/clear`: reset the conversation context back to just the system prompt (the
  session log on disk keeps the full history either way)
- `/compact`: ask the model to summarize the conversation so far and replace the
  live context with that summary, to free up space in long sessions

### Project instructions

Drop an `AGENTS.md`, `CLAUDE.md`, or `MINI.md` in your project root and mini will
inject it into the system prompt as project-specific context.

## Design notes

- **`src/llm/openrouter.ts`**: raw `fetch` + hand-rolled SSE parsing
  (`src/llm/sse.ts`). Tool-call argument fragments arrive across many stream
  chunks keyed by a numeric `index` (not `id`); `src/llm/tool-call-accumulator.ts`
  buffers and JSON-parses them once the stream signals completion, marking
  truncated (`finish_reason: "length"`) calls as malformed rather than crashing.
- **`src/agent/loop.ts`**: the core loop. Stream a response, run any tool calls,
  feed results back in, repeat until a turn produces zero tool calls (a 30-turn
  safety cap by default; see `MINI_MAX_TURNS` above).
- **`src/tools/edit.ts`**: each `oldText` must match the file's content exactly
  once; all edits in one call are computed against the original content (not
  chained), then returned as a unified diff (`src/tools/diff.ts`, a small
  dependency-free LCS-based differ).
- **`src/session/jsonl.ts`**: sessions are append-only JSONL files under
  `.mini/sessions/<id>.jsonl`: a header line, then one line per message.

## Tests, linting, and type checking

```bash
bun run check   # typecheck + lint + test, all at once (what CI runs)
bun test
```

(`bunfig.toml` scopes test discovery to `./test`; otherwise `bun test` would also
crawl `reference/pi/`, a huge monorepo.)

Covers the SSE parser, the tool-call delta accumulator (including the
truncated-arguments edge case), `edit`'s exact-match-once semantics, `grep`'s
matching/ignoring behavior, session persistence, arg parsing, the model picker's
ranking/formatting, and the read/write/ls/bash tools. All pure-function/tmpdir
unit tests written against `node:test`/`node:assert`, which Bun runs natively. No
network calls.

```bash
bun run test:coverage
```

Prints a per-file coverage table using Bun's built-in coverage reporter (no extra
dependency needed).

Linting and formatting run on [Biome](https://biomejs.dev): `bun run lint` (`biome check .`)
and `bun run format` (`biome format --write .`). `biome.json` is tuned to match the codebase's
existing style rather than the other way around.

## Versioning and releases

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat: ...`, `fix(scope): ...`, etc.; see `CLAUDE.md` for the full rules).
`scripts/version.ts` reads the commits since the last `v*` tag and figures out the
semver bump: any `!` breaking marker is major, `feat` is minor, `fix` is patch,
everything else doesn't move the version.

```bash
bun run version           # print what the next bump would be, don't touch anything
bun run release            # bump package.json, commit, tag (local only)
bun run release -- --push  # also push the commit and tag
bun run release -- --publish  # push + build dist/mini + cut a GitHub release via gh
```

The actual bump/commit/tag is `bun pm version` (built into Bun, no extra dependency).
`scripts/version.ts` just decides *which* bump to hand it.

## License

[Apache-2.0](LICENSE)
