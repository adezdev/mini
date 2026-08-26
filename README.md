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
- **Zero runtime dependencies**: only Bun's/Node's standard library. `typescript`/
  `bun-types` are dev-only, for editor support and type-checking. Bun runs the `.ts`
  sources directly, no build/transpile step needed.
- **Plain-text REPL**, not a differential-render TUI.
- **Eight tools**, seven for doing the work plus one for explaining itself. Confined
  to the project directory by default, with a small deny-list against unambiguously
  destructive commands and automatic per-turn checkpointing — see
  [docs/guardrails.md](docs/guardrails.md) for what makes this safe to leave running
  unattended.

## Quick start

Requires [Bun](https://bun.sh) `>=1.1`.

```bash
bun install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys
bun src/cli.ts
```

Or `bun link` to install a `mini` command, or `bun run compile` for a standalone
`dist/mini` binary. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Documentation

- **[docs/getting-started.md](docs/getting-started.md)** — install, setup, first session
- **[docs/cli.md](docs/cli.md)** — every flag and environment variable
- **[docs/repl-commands.md](docs/repl-commands.md)** — every interactive `/command`
- **[docs/tools.md](docs/tools.md)** — the built-in tools mini can call
- **[docs/extending.md](docs/extending.md)** — add your own tools via
  `.mini/tools/`, no restart needed
- **[docs/guardrails.md](docs/guardrails.md)** — checkpointing, self-check, bash
  tripwires, the filesystem boundary
- **[docs/architecture.md](docs/architecture.md)** — internals, for contributors

mini's own docs are also embedded into mini itself — ask it directly ("how do I use
`/refine`?", "what guardrails do you have?") and it looks them up rather than guessing.

## Development

```bash
bun run check   # typecheck + lint + test, all at once (what CI runs)
```

See [docs/architecture.md](docs/architecture.md) for testing conventions, and
[CLAUDE.md](CLAUDE.md) for contributor/agent-facing project conventions (commit
message format, versioning, release process).

## License

[Apache-2.0](LICENSE)
