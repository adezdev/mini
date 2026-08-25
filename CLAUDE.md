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
    `ls`) plus their shared helpers (`lines.ts`, `diff.ts`, `walk.ts`, `path-guard.ts`).
  - `src/session/jsonl.ts`: append-only JSONL session persistence.
  - `src/models.ts`, `src/system-prompt.ts`, `src/cli-args.ts`, `src/repl.ts`, `src/cli.ts`:
    model listing/picker, system prompt assembly, CLI arg parsing, the REPL, and the entry
    point.
  - `src/refine.ts`: the `/refine` REPL command's logic — asks the model what this session
    taught it worth adding to the project instructions file, reusing `edit.ts`'s `applyEdits`
    and `diff.ts`'s `unifiedDiff` rather than inventing new apply/diff code.
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
  - `bash.ts`: runs commands against one persistent shell process kept alive for the tool
    instance's lifetime (not a fresh spawn per call), so `cd` and exported env vars carry over
    between calls. Commands are framed with a sentinel echo (`echo "<token>:$?"`) written to
    the shell's stdin to recover output boundaries and exit codes without a wrapper process. A
    timeout kills the shell outright and the next call transparently respawns it — interrupting
    just the foreground job needs real job control (a pty, or non-portable tools like `setsid`),
    which mini doesn't have. A command like `exit` also kills the shell itself before the
    trailing sentinel echo can run; `runExclusive` falls back to the process's own `exit` event
    in that case instead of hanging until timeout. Each command must be syntactically complete
    on its own — no unterminated quotes/heredocs waiting for more input.
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
  - `path-guard.ts`: `resolveInRoot(root, path)` confines every path-taking tool (`read`,
    `write`, `edit`, `ls`, `grep`, `find`) to the project directory — rejects a resolved path
    that escapes `cwd` (an absolute `/etc/passwd`, a relative `../../.ssh/id_rsa`), returned as
    a normal `{content, isError: true}` result so the model can recover rather than crashing
    mini. Deliberately doesn't cover: symlinks planted inside the root pointing outside it
    (would need a `realpath` check per call), or anything reached through `bash`, which is
    arbitrary shell and can't be filesystem-contained without a real sandbox. Part of the
    walk-away-autonomy guardrail work — see the roadmap in project memory.
- **OpenRouter streaming:** tool-call argument fragments arrive across many stream chunks
  addressed by a stable **numeric `index`** (not `id`, which may only appear on the first
  chunk for that index). `ToolCallAccumulator` buffers per-index argument fragments and only
  `JSON.parse`s once the stream's `finish_reason` arrives, marking calls truncated by
  `finish_reason: "length"` as `malformed` rather than crashing.
- **Agent loop cap:** `runAgentLoop` stops after `maxTurns` (default 30, overridable via
  `MINI_MAX_TURNS`) so a runaway tool-call loop can't run forever. It mutates the `messages`
  array in place and reports progress through an `onEvent` callback (`text_delta`,
  `tool_call_start/end`, `usage`, `turn_end`). Every tool call runs against `RunAgentLoopOptions.cwd`
  (defaults to `process.cwd()` if omitted) — always pass `config.cwd` explicitly from real
  callers; it only happens to equal `process.cwd()` in production because `loadConfig` captures
  it at startup, and a caller that forgets this silently falls back to the real process's cwd
  instead of the one it meant, which is exactly what happened before this was a parameter (see
  `checkpoint.ts` below — the bug surfaced when a test nearly wrote a stray file into this repo).
- **CLI arg parsing** is factored into `src/cli-args.ts` (`parseArgs`) separately from
  `src/cli.ts`'s `main()` specifically so it's importable/testable without triggering the
  CLI's side effects (`main()` runs immediately on import of `cli.ts`).
- **Model picker filtering** (`src/models.ts`, `rankForPicker`): only lists tool-capable
  models with at least `MIN_CONTEXT_LENGTH` (200k) context. mini has no context-window
  awareness or automatic history pruning beyond the manual `/compact`/`/clear` commands, and
  a real coding session's peak accumulated history routinely lands in the 100k-200k range, so
  smaller-context models would fail mid-session with a provider context-length error.
- **Project instructions file resolution** (`src/system-prompt.ts`,
  `findProjectInstructionsPath`): first match wins, checked in order `MINI.md`, `CLAUDE.md`,
  `AGENTS.md` — mini's own native file takes priority over the generic cross-tool one. Only
  one file is ever loaded, never merged. `/refine` (`src/refine.ts`) uses this same resolver
  so it always edits whichever file actually got loaded into the system prompt this session,
  never a hardcoded name.
- **Context usage warning** (`src/repl.ts`, `checkContextUsage`): mini has no automatic history
  pruning, so a long session can walk right up to a model's context limit and get a provider
  error mid-task. After each turn, once that turn's prompt token count crosses 80% of the
  model's `contextLength` (from the same cached `/models` list `/cost` already fetches), the
  REPL prints a one-line nudge toward `/compact`. Fires once per session and re-arms on
  `/clear`/`/compact` — a nudge, not an automatic action, matching mini's stance of never
  silently mutating conversation state on the user's behalf.
- **Checkpointing** (`src/checkpoint.ts`): commits whatever a turn changed, per turn, so a
  mistake is `git revert`-able instead of buried in a pile of diffs — part of the walk-away-
  autonomy guardrail work (roadmap in project memory). `initCheckpointing(cwd, sessionId)`
  runs once per session and decides whether/where:
  - No-ops silently on a non-repo or any git error; disables with a one-line notice if the
    starting tree isn't clean (checkpointing covers mini's own changes, not pre-existing WIP).
  - If the current branch is the repo's default (`origin/HEAD`'s target, else a local
    `main`/`master` if one exists, else — no established convention to go on — the current
    branch itself) or HEAD is detached, checkpoint commits go on a fresh `mini/<sessionId
    prefix>` branch instead of polluting it. Otherwise commits land in place on whatever
    branch was already checked out. `--resume`/re-running with the same session id reuses the
    same `mini/` branch if it still exists.
  - `commitCheckpointIfDirty(state, promptText)` runs after every turn (and after a confirmed
    `/refine` write): `git add`/`git commit` scoped to exclude `.mini/` (mini's own session
    logs land there and would otherwise make the tree look dirty on every single turn) with
    the repo's normal hooks running — not skipped with `--no-verify`, since a hook is itself a
    guardrail. A hook rejection is reported as a turn-level error, not silently swallowed.
  - Deliberately not built: auto-squashing, auto-merging into the real branch, auto-deleting a
    branch after a bad run. All manual, on purpose.
- **Self-check** (`src/repl.ts`, `runPass`/`runTurn`): the third walk-away-autonomy guardrail
  item (roadmap in project memory) — nothing previously told mini to notice it might have
  broken something. mini's harness deliberately doesn't try to know or guess a project's check
  command (no `package.json`-script parsing, no `Makefile` heuristics); the model already knows
  how, since it's read the project's own instructions file and been running its own checks all
  session. Instead: `runTurn` calls the new `runPass` helper twice when a turn's tool calls
  included a successful `write`/`edit`/`bash` (tracked from `tool_call_end` events, not from
  checkpointing's git status, so this works even without git) — once for the real turn, then
  once more with a synthetic instruction telling the model to verify and fix before finishing,
  shown plainly in the transcript prefixed `[auto self-check]`, never hidden. Bounded to exactly
  one self-check pass per user turn — it does not chain a second self-check off the first one's
  own changes, even if that pass changes files too (that's what checkpointing/revert is for, not
  a retry loop). The self-check pass's own changes get checkpointed like anything else, as a
  separate commit. Opt out per-invocation with `MINI_SELF_CHECK=0` — read live via
  `selfCheckEnabled()`, not cached at module load, so it stays testable/toggleable (the same
  category of mistake `RunAgentLoopOptions.cwd` had before it became a real parameter).

## Documentation

- `README.md` is the user-facing doc (setup, usage, REPL commands, versioning); this file is
  agent/contributor-facing instructions and architecture notes. Keep both in sync when a
  subsystem changes shape, not just this file.
- There's no separate `docs/` directory; a project this size doesn't need one yet.
