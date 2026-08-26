# mini Project Context

`mini` is a from-scratch, zero-runtime-dependency coding agent CLI built on Bun: an agent
loop, a plain-text REPL, and eight built-in tools, talking only to OpenRouter.

Full documentation lives in `docs/` (see `docs/README.md` for the index) — this file covers
only what's needed to build, test, and commit to this repo. Read `docs/architecture.md` before
changing any subsystem's internals.

## Project Overview

- **Purpose:** A terminal coding agent scoped to what one solo developer actually needs day to
  day, not a monorepo platform. One LLM provider, one REPL, eight tools.
- **Main Technologies:**
  - **Runtime:** [Bun](https://bun.sh) (`>=1.1`), no Node required.
  - **Language:** TypeScript, run directly by Bun with no build/transpile step.
  - **LLM Provider:** OpenRouter only (OpenAI-compatible `/chat/completions`), reached with a
    raw `fetch` and hand-rolled SSE parsing, no SDK.
  - **UI:** plain-text REPL (`node:readline/promises`), no differential-render TUI.
  - **Testing:** `bun:test` (Node's `node:test`/`node:assert` API, run natively by Bun).
- **Architecture:** Single package, no monorepo, no workspaces. File-by-file breakdown,
  streaming/tool-call mechanics, and every subsystem's internal design (checkpointing,
  self-check, bash tripwires, path confinement, dynamic tool loading, the `docs` tool's
  build-time text embedding) are in `docs/architecture.md`, not duplicated here.

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
- Testing conventions (mock patterns, temp-dir fixtures, real-git-repo fixtures) are documented
  alongside the subsystems they test in `docs/architecture.md`.

## Development Conventions

- **Commit messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <description>`, imperative mood, lowercase, no trailing period, ≤50 chars
  (`feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`build`/`ci`/`chore`/`revert`, `!`
  before the colon for a breaking change). Body wrapped ~72 chars, explains *what*/*why* not
  *how*. This isn't just style: `scripts/version.ts` parses commit subjects to compute the
  next release version, so a non-conforming subject silently doesn't count toward a bump.
- **Versioning and releases:** `scripts/version.ts` walks commits since the last `v*` tag and
  picks major/minor/patch/none from `!`/`feat`/`fix`/everything-else, then hands the bump type
  to `bun pm version`. `scripts/release.ts` wraps that with checks and optional `--push`/
  `--publish`. Run `bun run version` to preview the next bump, `bun run release` to cut it.
  Full detail: `docs/architecture.md#versioning-and-releases`.
- **Tool contracts, subsystem internals, and every guardrail's implementation** live in
  `docs/architecture.md` — read it before touching `src/tools/`, `src/checkpoint.ts`,
  `src/git.ts`, or `src/system-prompt.ts`.

## Documentation

- `docs/` is mini's real documentation — getting started, CLI/REPL/tool reference, the
  guardrail system, and architecture internals. It's also embedded into mini itself (the
  `docs` tool), so the model can look itself up instead of guessing when a user asks how mini
  works. See `docs/README.md` for the index.
- `README.md` is a short entry point: positioning, quick start, links into `docs/`. This file
  is a short entry point too: build/test/commit essentials, links into `docs/architecture.md`
  for everything else.
- Keep all three in sync when a subsystem changes shape: update the relevant `docs/*.md` file,
  and only touch `README.md`/this file if the change affects what belongs at the entry-point
  level (a new doc topic, a new top-level command, a changed build step).
- No plugin/extension mechanism exists yet, so there's no doc for one. Don't add speculative
  docs for unbuilt features.
