# mini Project Context

`mini` is a from-scratch, zero-runtime-dependency coding agent CLI built on Bun: an agent
loop, a plain-text REPL, and a handful of built-in tools, talking only to OpenRouter.

## Project Overview

- **Purpose:** A terminal coding agent scoped to what one solo developer actually needs day to
  day, not a monorepo platform. One LLM provider, one REPL, seven tools.
- **Main Technologies:**
  - **Runtime:** [Bun](https://bun.sh) (`>=1.1`), no Node required.
  - **Language:** TypeScript, run directly by Bun with no build/transpile step.
  - **LLM Provider:** OpenRouter only (OpenAI-compatible `/chat/completions`), reached with a
    raw `fetch` and hand-rolled SSE parsing, no SDK.
  - **UI:** plain-text REPL (`node:readline/promises`), no differential-render TUI.
  - **Testing:** `bun:test` (Node's `node:test`/`node:assert` API, run natively by Bun).
- **Architecture:** Single package, no monorepo, no workspaces.
  - `src/agent/loop.ts`: the agent loop (`runAgentLoop`), stream a response, run any tool
    calls, feed results back in, repeat until a turn produces zero tool calls.
  - `src/llm/`: the OpenRouter client (`openrouter.ts`), SSE parsing (`sse.ts`), and the
    tool-call streaming-delta accumulator (`tool-call-accumulator.ts`).
  - `src/tools/`: the seven built-in tools (`read`, `write`, `edit`, `bash`, `grep`, `find`,
    `ls`) plus their shared helpers (`lines.ts`, `diff.ts`, `walk.ts`).
  - `src/session/jsonl.ts`: append-only JSONL session persistence.
  - `src/models.ts`, `src/system-prompt.ts`, `src/cli-args.ts`, `src/repl.ts`, `src/cli.ts`:
    model listing/picker, system prompt assembly, CLI arg parsing, the REPL, and the entry
    point.
  - `scripts/version.ts`, `scripts/release.ts`: versioning and release tooling (see
    Development Conventions below).

## Building and Running

- **Install dependencies:** `bun install` (dev-only: `typescript`, `bun-types`; zero runtime
  dependencies).
- **Run interactively:** `bun src/cli.ts`
- **One-shot mode:** `bun src/cli.ts -p "<prompt>"`
- **Resume a session:** `bun src/cli.ts --resume <sessionId>`
- **Global command:** `bun link`, then run `mini` directly (shebang `#!/usr/bin/env bun`).
- **Standalone binary:** `bun run compile` produces `dist/mini` (~77MB, bundles the Bun
  runtime, no Bun install needed on the target machine).

## Testing and Quality

- **Unit tests:** `bun run test` (equivalent to `bun test --isolate`).
- **Single file:** `bun test --isolate test/edit.test.ts`
- **Coverage:** `bun run test:coverage` (Bun's built-in coverage reporter, no extra
  dependency).
- **Type check:** `bun run typecheck` (`tsc --noEmit`).
- **Lint/format:** `bun run lint` (`biome check .`), `bun run format` (`biome format --write .`).
  `biome.json` is tuned to match the codebase's existing style, not the other way around.
- **Everything at once:** `bun run check` (typecheck + lint + test). CI runs the same three
  steps on every push/PR to `master`.
- **Always run tests with `--isolate`.** Without it, Bun's `node:test` compat shares global
  state across concurrently-run test files; an async test still in flight in one file can
  leave a shared "inside a test" flag set while the next file registers its tests, throwing a
  bogus `test() inside another test()` error (a known Bun limitation, oven-sh/bun#5090). Both
  `test` and `test:coverage` scripts already pass the flag.
- `bunfig.toml` scopes `bun test` discovery to `./test`: without it, a bare `bun test` would
  also crawl anything else in the working tree, including large gitignored local directories.
- Requires Bun and `OPENROUTER_API_KEY` set for actually running the agent (not needed for
  tests: network calls are mocked via `globalThis.fetch` swapping, no mocking library).

## Development Conventions

- **Commit messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <description>`, imperative mood, lowercase, no trailing period, ≤50 chars
  (`feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`build`/`ci`/`chore`/`revert`, `!`
  before the colon for a breaking change). Body wrapped ~72 chars, explains *what*/*why* not
  *how*. This isn't just style: `scripts/version.ts` parses commit subjects to compute the
  next release version, so a non-conforming subject silently doesn't count toward a bump.
- **Versioning and releases:** `scripts/version.ts` walks commits since the last `v*` tag and
  picks major/minor/patch/none from `!`/`feat`/`fix`/everything-else, then hands the bump type
  to `bun pm version` (built into Bun; does the actual package.json write + commit + tag, and
  refuses a dirty tree on its own). `scripts/release.ts` wraps that with checks and optional
  `--push`/`--publish` (the latter builds `dist/mini` and cuts a GitHub release via `gh`). Run
  `bun run version` to preview the next bump, `bun run release` to cut it.
- **Tool contracts:** each tool in `src/tools/` is an `AgentTool`: `{name, description,
  parameters (JSON Schema), execute(args, cwd)}`. Notable ones:
  - `edit.ts`: each `oldText` must match the file's content **exactly once**; when a call has
    multiple edits, all are computed against the *original* content (not chained
    sequentially; see `applyEdits`, kept as a pure function separate from file I/O for
    testing), then returned as a unified diff.
  - `lines.ts`: `splitLines()` is used everywhere file content gets split into lines instead
    of a bare `.split("\n")`: a trailing newline terminates the last line rather than starting
    a phantom empty one, matching how editors/diff tools count.
  - `walk.ts`: the recursive `fs` walk + `.gitignore` handling (literal names and simple `*`
    globs, not the full gitignore spec) shared by `grep.ts` and `find.ts`.
  - `find.ts`: glob matching over that walk. A pattern with `/` matches the full relative
    path, otherwise just the basename (mirrors `fd`'s behavior).
- **OpenRouter streaming:** tool-call argument fragments arrive across many stream chunks
  addressed by a stable **numeric `index`** (not `id`, which may only appear on the first
  chunk for that index). `ToolCallAccumulator` buffers per-index argument fragments and only
  `JSON.parse`s once the stream's `finish_reason` arrives, marking calls truncated by
  `finish_reason: "length"` as `malformed` rather than crashing.
- **Agent loop cap:** `runAgentLoop` stops after `maxTurns` (default 30, overridable via
  `MINI_MAX_TURNS`) so a runaway tool-call loop can't run forever. It mutates the `messages`
  array in place and reports progress through an `onEvent` callback (`text_delta`,
  `tool_call_start/end`, `usage`, `turn_end`).
- **CLI arg parsing** is factored into `src/cli-args.ts` (`parseArgs`) separately from
  `src/cli.ts`'s `main()` specifically so it's importable/testable without triggering the
  CLI's side effects (`main()` runs immediately on import of `cli.ts`).
- **Model picker filtering** (`src/models.ts`, `rankForPicker`): only lists tool-capable
  models with at least `MIN_CONTEXT_LENGTH` (200k) context. mini has no context-window
  awareness or automatic history pruning beyond the manual `/compact`/`/clear` commands, and
  a real coding session's peak accumulated history routinely lands in the 100k-200k range, so
  smaller-context models would fail mid-session with a provider context-length error.

## Documentation

- `README.md` is the user-facing doc (setup, usage, REPL commands, versioning); this file is
  agent/contributor-facing instructions and architecture notes. Keep both in sync when a
  subsystem changes shape, not just this file.
- There's no separate `docs/` directory; a project this size doesn't need one yet.
