# Getting Started

## Install

Requires [Bun](https://bun.sh) `>=1.1` (`sudo pacman -S bun` on Arch, or see
bun.sh/docs/installation). No Node install needed — Bun runs the TypeScript
sources directly.

```bash
git clone https://github.com/adezdev/mini.git
cd mini
bun install
```

`bun install` only pulls dev dependencies (`typescript`, `bun-types`, for
editor support and type-checking). mini has zero runtime dependencies.

## Get an API key

mini talks to [OpenRouter](https://openrouter.ai) only — one key, access to
many models, including several free ones.

```bash
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys
```

Put that in your shell profile if you don't want to set it every session.

## Run it

```bash
bun src/cli.ts
```

Starts an interactive REPL in the current directory. Type a request, watch
mini read/write files and run commands to get there.

```bash
bun src/cli.ts -p "list the files in this repo"
```

One-shot mode: runs a single prompt to completion and exits, no REPL. Good
for scripting or CI.

## Install it as a command

```bash
bun link
mini
```

Symlinks a global `mini` command pointing at this checkout — edits to the
source take effect immediately, no rebuild step.

For a fully standalone binary (no Bun install required on the target
machine):

```bash
bun run compile
./dist/mini
```

Produces a single ~77MB executable that bundles the Bun runtime itself.

## Your first session

```
$ mini

mini v0.12.0 (model: nvidia/nemotron-3-super-120b-a12b:free)

  /help    all commands           /model   switch models
  /effort  reasoning effort       /cost    token usage & cost
  /clear   reset context          /exit    quit

mini reads and edits your files, runs shell commands, and checkpoints
its own work as it goes. Type a request to begin.

session: 3f2a1b9c-...

> add a .gitignore for a Bun/TypeScript project
```

From here mini will use its tools (see [tools.md](tools.md)) to look at your
project and make the change, checkpointing the result if you're in a clean
git repo (see [guardrails.md](guardrails.md)). Type `/help` any time to see
the interactive commands (full reference: [repl-commands.md](repl-commands.md)),
or `/exit` to quit.

## Picking a model

The default is a free OpenRouter model, but availability on free tiers is a
shared pool and can get rate-limited under load. Switch mid-session with
`/model` (fetches a live, filtered list) or `/model <id>` (switch directly).
See [cli.md](cli.md) for the full flag/env-var picture.

## Next

- [cli.md](cli.md) — every flag and environment variable
- [repl-commands.md](repl-commands.md) — every interactive command
- [tools.md](tools.md) — what mini can actually do to your files and shell
- [guardrails.md](guardrails.md) — what keeps an unattended session safe
