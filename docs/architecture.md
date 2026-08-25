# Architecture

Internals worth knowing before changing mini's own code. User-facing
behavior lives in [guardrails.md](guardrails.md), [tools.md](tools.md), and
[repl-commands.md](repl-commands.md) — this doc is about how it's built.

## File layout

- `src/agent/loop.ts`: the agent loop (`runAgentLoop`) — stream a response,
  run any tool calls, feed results back in, repeat until a turn produces
  zero tool calls or hits `maxTurns`. Mutates the `messages` array in
  place and reports progress through an `onEvent` callback (`text_delta`,
  `tool_call_start/end`, `usage`, `turn_end`).
- `src/llm/`: the OpenRouter client (`openrouter.ts`), SSE parsing
  (`sse.ts`), and the tool-call streaming-delta accumulator
  (`tool-call-accumulator.ts`).
- `src/tools/`: the eight built-in tools plus shared helpers (`lines.ts`,
  `diff.ts`, `walk.ts`, `path-guard.ts`).
- `src/session/jsonl.ts`: append-only JSONL session persistence.
  `Session.create` also drops a `.mini/.gitignore` (just `*`) the first time
  `.mini/` is created in a project, so mini's own session logs never show up
  in `git status`/`git add .` — not just for checkpointing's own commits
  (which already exclude `.mini/` via pathspec) but for the model's own
  manual git commands too. Without this, a model running `git init` as part
  of a task and then `git add .` will happily stage its own session log into
  the user's first commit — observed in practice, not hypothetical.
- `src/git.ts`: small `runGit`/`resolveProtectedBranch`/`getCurrentBranch`
  helpers shared by `checkpoint.ts` and `tools/tripwires.ts`.
- `src/checkpoint.ts`: per-turn checkpoint commits.
- `src/refine.ts`: the `/refine` REPL command's logic.
- `src/models.ts`, `src/system-prompt.ts`, `src/cli-args.ts`, `src/repl.ts`,
  `src/cli.ts`: model listing/picker, system prompt assembly, CLI arg
  parsing, the REPL, and the entry point.
- `scripts/version.ts`, `scripts/release.ts`: versioning and release
  tooling (see [Versioning and releases](#versioning-and-releases)).

## OpenRouter streaming

Tool-call argument fragments arrive across many stream chunks, addressed by
a stable **numeric `index`** — not `id`, which may only appear on the first
chunk for that index. `ToolCallAccumulator` buffers per-index argument
fragments and only `JSON.parse`s once the stream's `finish_reason` arrives,
marking calls truncated by `finish_reason: "length"` as `malformed` rather
than crashing.

Every tool call runs against `RunAgentLoopOptions.cwd` (defaults to
`process.cwd()` if omitted) — always pass `config.cwd` explicitly from real
callers. It only happens to equal `process.cwd()` in production because
`loadConfig` captures it at startup; a caller that forgets this silently
falls back to the real process's cwd instead of the one it meant. That's
exactly what happened before `cwd` was a parameter at all — a checkpoint
integration test very nearly wrote a stray file into this actual repo
before the bug was caught and fixed.

## Tool contracts

Each tool in `src/tools/` is an `AgentTool`:
`{name, description, parameters (JSON Schema), execute(args, cwd)}`.
Notable ones:

- **`bash.ts`**: runs commands against one persistent shell process kept
  alive for the tool instance's lifetime (not a fresh spawn per call), so
  `cd` and exported env vars carry over between calls. Commands are framed
  with a sentinel echo (`echo "<token>:$?"`) written to the shell's stdin
  to recover output boundaries and exit codes without a wrapper process. A
  timeout kills the shell outright and the next call transparently
  respawns it — interrupting just the foreground job needs real job
  control (a pty, or non-portable tools like `setsid`), which mini doesn't
  have. A command like `exit` also kills the shell itself before the
  trailing sentinel echo can run; `runExclusive` falls back to the
  process's own `exit` event in that case instead of hanging until
  timeout. Each command must be syntactically complete on its own — no
  unterminated quotes/heredocs waiting for more input. Before any of that,
  `bashTool.execute` checks the command against `tripwires.ts`'s
  `checkTripwire` (see [Bash tripwires internals](#bash-tripwires-internals)
  below).
- **`edit.ts`**: each `oldText` must match the file's content **exactly
  once**; when a call has multiple edits, all are computed against the
  *original* content (not chained sequentially; see `applyEdits`, kept as a
  pure function separate from file I/O for testing), then returned as a
  unified diff. `validateEdits` rejects a malformed `edits` argument (not an
  array — including a JSON-*encoded string* of one, a mistake weaker models
  make — missing `oldText`/`newText`, an empty array) with a message naming
  the specific problem, before `applyEdits` ever runs; a non-string `path`
  gets the same treatment. Both were previously unhandled `TypeError`s
  surfaced verbatim as "Tool threw an error: ..." — technically caught by
  `loop.ts` so they didn't crash mini, but useless for the model to act on.
- **`lines.ts`**: `splitLines()` is used everywhere file content gets split
  into lines instead of a bare `.split("\n")`: a trailing newline
  terminates the last line rather than starting a phantom empty one,
  matching how editors/diff tools count.
- **`walk.ts`**: the recursive `fs` walk + `.gitignore` handling (literal
  names and simple `*` globs, not the full gitignore spec) shared by
  `grep.ts` and `find.ts`.
- **`find.ts`**: glob matching over that walk. A pattern with `/` matches
  the full relative path, otherwise just the basename (mirrors `fd`'s
  behavior).
- **`path-guard.ts`**: `resolveInRoot(root, path)` confines every
  path-taking tool to the project directory — rejects a resolved path that
  escapes `cwd`, returned as a normal `{content, isError: true}` result so
  the model can recover rather than crashing mini. See
  [guardrails.md](guardrails.md#filesystem-boundary) for the user-facing
  picture, including the deliberately unsolved gaps (symlinks, `bash`).
- **`docs.ts`**: `DOCS`, a `Record<string, DocEntry>` built from
  compile-time text imports (`import x from "../../docs/foo.md" with
  { type: "text" }`, typed via `src/global.d.ts`'s ambient `*.md` module
  declaration). No dynamic filesystem read at all — the topic key only ever
  indexes into this fixed, closed set, so there's no path the model could
  supply to make this tool read anything outside `docs/`. This is
  deliberately a separate tool rather than an exception carved into
  `read`/`grep`/`find`'s path confinement: it keeps that confinement's
  guarantee ("stays inside one root") intact and total, instead of adding
  a special case to reason about. It also works identically whether mini
  is run from source, via `bun link`, or as the compiled `dist/mini`
  binary, since Bun embeds the text at bundle time rather than mini
  resolving its own install path at runtime.

### Bash tripwires internals

`checkTripwire(command, cwd)` in `src/tools/tripwires.ts` runs three
checks, the first two pure regex/tokenization (no shell-out), the third
using `git.ts`:

1. `isRootWipe`: tokenizes each `;`/`&&`/`||`/newline-separated
   sub-command, looks for `rm` followed by both a recursive and a force
   flag (any order/form) and a bare `/`/`~`/`$HOME`/`${HOME}`/`/*` target.
2. A regex for `curl`/`wget` piped into `sudo sh`/`bash`/`zsh`/`dash`.
3. `checkGitForcePush`: parses `git push` sub-commands for a force flag,
   resolves the target branch (from an explicit refspec, or the current
   branch if none given), and compares it against
   `resolveProtectedBranch` — the same resolver `checkpoint.ts` uses.

No in-band override anywhere (no `force: true` on the tool call — a model
that could flip it would learn to always flip it); the only escape hatch is
`MINI_BASH_TRIPWIRES=0`, set by the human before the session starts, read
live via `tripwiresEnabled()` rather than cached at import (same lesson as
`selfCheckEnabled()` below — an env var frozen into a module-level constant
at import time can't be toggled or tested within one process).

## Checkpointing internals

`initCheckpointing(cwd, sessionId)` in `src/checkpoint.ts` runs once per
session and decides whether/where checkpoint commits happen — see
[guardrails.md](guardrails.md#checkpointing) for the user-facing behavior.
Implementation notes:

- `commitCheckpointIfDirty(state, promptText)` runs after every turn (and
  after a confirmed `/refine` write): `git add`/`git commit` scoped to
  exclude `.mini/` via git pathspec (`-- . ':!.mini'`) — mini's own session
  logs land under `.mini/sessions/*.jsonl` inside the project directory the
  moment a session starts, and without this exclusion every session would
  look dirty from the very first turn, defeating the clean-tree gate.
- Branch resolution (`resolveProtectedBranch`, `getCurrentBranch`) lives in
  `src/git.ts`, not `checkpoint.ts` itself, specifically so
  `tools/tripwires.ts`'s force-push check can reuse it instead of
  duplicating the logic.

## Self-check internals

`src/repl.ts`'s `runPass`/`runTurn`/`selfCheckEnabled` — see
[guardrails.md](guardrails.md#self-check) for the user-facing behavior.
`runTurn` calls the `runPass` helper twice when a turn's tool calls
included a successful `write`/`edit`/`bash`, tracked directly from
`tool_call_end` loop events (not from checkpointing's git status, so this
works even without git). The second pass's prompt is a synthetic
`[auto self-check]`-prefixed instruction; both passes flow through the same
`commitCheckpointIfDirty` call, so a self-fix gets its own checkpoint
commit, separate from the original change.

## System prompt self-awareness

`buildSystemPrompt` in `src/system-prompt.ts` tells the model about mini's
own automatic harness behaviors — checkpointing, the self-check pass, and
the bash tripwires — in addition to the tool list, so it isn't confused
when a `[auto self-check]` turn appears unprompted, doesn't try to
`git commit` changes mini already checkpointed, and doesn't retry a refused
destructive command verbatim. This is static text, not conditioned on
whether checkpointing/tripwires are actually active this session — that
state isn't known yet at prompt-build time (`initCheckpointing` runs later,
inside `runReplLoop`/`runOneShot`), and general awareness is the point
here, not per-session precision.

## Project instructions file resolution

`findProjectInstructionsPath` in `src/system-prompt.ts`: first match wins,
checked in order `MINI.md`, `CLAUDE.md`, `AGENTS.md` — mini's own native
file takes priority over the generic cross-tool one. Only one file is ever
loaded, never merged. `/refine` uses this same resolver so it always edits
whichever file actually got loaded into the system prompt this session,
never a hardcoded name.

## Model picker filtering

`rankForPicker` in `src/models.ts`: only lists tool-capable models with at
least `MIN_CONTEXT_LENGTH` (200k) context. mini has no context-window
awareness or automatic history pruning beyond the manual
`/compact`/`/clear` commands, and a real coding session's peak accumulated
history routinely lands in the 100k-200k range, so smaller-context models
would fail mid-session with a provider context-length error.

## CLI arg parsing

Factored into `src/cli-args.ts` (`parseArgs`) separately from `src/cli.ts`'s
`main()` specifically so it's importable/testable without triggering the
CLI's side effects (`main()` runs immediately on import of `cli.ts`).

## Testing

- **Run everything**: `bun run check` (typecheck + lint + test — what CI
  runs). Single file: `bun test --isolate test/edit.test.ts`. Coverage:
  `bun run test:coverage`.
- **Always run tests with `--isolate`.** Without it, Bun's `node:test`
  compat shares global state across concurrently-run test files; an async
  test still in flight in one file can leave a shared "inside a test" flag
  set while the next file registers its tests, throwing a bogus
  `test() inside another test()` error (a known Bun limitation,
  oven-sh/bun#5090). Both `test` and `test:coverage` scripts already pass
  the flag.
- `bunfig.toml` scopes `bun test` discovery to `./test`: without it, a bare
  `bun test` would also crawl anything else in the working tree, including
  large gitignored local directories.
- Network calls are mocked via `globalThis.fetch` swapping — no mocking
  library, no real `OPENROUTER_API_KEY` needed to run the suite.

## Versioning and releases

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/):
`<type>(<scope>): <description>`, imperative mood, lowercase, no trailing
period, ≤50 chars. This isn't just style — `scripts/version.ts` parses
commit subjects to compute the next release version, so a non-conforming
subject silently doesn't count toward a bump.

`scripts/version.ts` walks commits since the last `v*` tag and picks
major/minor/patch/none from `!`/`feat`/`fix`/everything-else, then hands
the bump type to `bun pm version` (built into Bun; does the actual
package.json write + commit + tag, and refuses a dirty tree on its own).
`scripts/release.ts` wraps that with checks and optional `--push`/
`--publish` (the latter builds `dist/mini` and cuts a GitHub release via
`gh`).

```bash
bun run version              # preview the next bump, don't touch anything
bun run release               # bump, commit, tag (local only)
bun run release -- --push     # also push the commit and tag
bun run release -- --publish  # push + build dist/mini + cut a GitHub release
```
