# REPL Commands

Interactive-session commands, typed at the `>` prompt. All start with `/`.

## `/help`

Lists all interactive commands with a one-line description each.

## `/model`

Fetches the current tool-capable model list from OpenRouter, filters to
models with at least 200k context (a real coding session's peak accumulated
history routinely lands in the 100k-200k range, and mini's automatic
pruning only trims stale tool output and compacts near the context limit,
not a substitute for headroom — see
[guardrails.md](guardrails.md#context-usage-warning-and-auto-compact)),
prints it (free models first, then cheapest-to-most-expensive), and lets you
pick by number or type an id directly.

Typing something that starts with `/` at the `model>` prompt is rejected
rather than set as a literal model id — a real OpenRouter id is always
`vendor/name` shaped and never starts with `/`, so this catches "meant to
type a REPL command, ended up in the picker" instead of silently switching
to a nonsense "model."

## `/model <id>`

Switch straight to a known model id — no fetch, no prompt. Same `/`-prefix
rejection applies here too.

## `/tools`

Lists the built-in tools and their descriptions (see
[tools.md](tools.md)).

## `/system`

Prints the current system prompt verbatim — useful for seeing exactly what's
sent to the model, including any loaded project instructions file.

## `/cost`

Shows cumulative token usage for the session (prompt + completion), plus an
estimated dollar cost for the current model. Pricing is fetched from
OpenRouter on first use and cached for the rest of the session.

## `/sessions`

Lists saved sessions for the current directory — the same data
`--list-sessions` prints, plus a marker on whichever one is currently active.

## `/resume <id>`

Resumes a saved session's message history, replacing the current context.
Works mid-session, not just at startup (`--resume` on the command line does
that).

## `/clear`

Resets the conversation context back to just the system prompt. The session
log on disk keeps the full history either way — this only affects what's
sent to the model going forward. Also re-arms the context-usage warning (see
[guardrails.md](guardrails.md#context-usage-warning-and-auto-compact)).

## `/compact`

Asks the model to summarize the conversation so far, then replaces the live
context with that summary — frees up space in long sessions without losing
the gist of what happened. Also re-arms the context-usage warning.

## `/refine`

Asks the model what this session taught it that's worth adding to the
project's instructions file (whichever one `/model`'s companion resolver
found — see [cli.md](cli.md#project-instructions)), then shows a diff and
asks for confirmation before writing anything. Never applies silently, and
never creates a new instructions file if none exists yet.

## `/exit`, `/quit`

Quit. (Also: Ctrl+D / EOF on stdin exits quietly.)
