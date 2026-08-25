# mini Documentation

- **[Getting Started](getting-started.md)** — install, set up your API key,
  run your first session.
- **[CLI Reference](cli.md)** — every flag and environment variable.
- **[REPL Commands](repl-commands.md)** — every interactive `/command`.
- **[Built-in Tools](tools.md)** — the eight tools mini can call, including
  the filesystem boundary that confines most of them.
- **[Guardrails](guardrails.md)** — checkpointing, self-check, bash
  tripwires, and the context-usage warning: what makes it reasonable to
  start mini and walk away.
- **[Architecture](architecture.md)** — internals, for anyone changing
  mini's own code.

This directory is also embedded into mini itself (see the `docs` tool in
[tools.md](tools.md#docs)) — ask mini directly and it'll look these up.

Extending mini with custom tools or plugins isn't supported yet; there's no
doc for it because there's nothing to document.
