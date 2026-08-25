# Built-in Tools

mini gives the model eight tools: seven for doing the work, plus `docs` for
explaining itself. `/tools` in the REPL prints the live list with the exact
descriptions sent to the model.

## `read`

Reads a text file, line-numbered. Supports `offset`/`limit` for slicing
large files; caps output at 2000 lines / 256KB per call and tells the model
what `offset` to use to keep reading. Refuses to decode a file that looks
binary (contains a null byte) rather than returning garbage.

## `write`

Creates a new file or overwrites an existing one with the given content,
creating intermediate directories as needed.

## `edit`

Applies one or more exact string replacements to a file. Each `oldText` must
appear **exactly once** in the file's current content — an ambiguous or
missing match is reported as an error, not guessed at. Multiple edits in one
call are computed against the file's *original* content, not chained, so
they can't interfere with each other's line numbers. Returns a unified diff
of the change. Malformed args (`edits` sent as something other than an
array, a missing `oldText`/`newText`, a non-string `path`) are rejected
with a specific message describing what was wrong, rather than throwing a
raw JS error the model can't act on.

## `bash`

Executes a shell command. Runs in **one persistent shell kept alive for the
whole session** — `cd` and exported environment variables carry over between
calls, unlike a fresh shell spawned per call. Returns merged stdout+stderr.

A timeout kills the shell outright and the next call transparently
respawns it, rather than trying to interrupt just the offending command —
that needs real job control (a pty, or non-portable tools like `setsid`),
which mini deliberately doesn't take on as a dependency. Each command must
be syntactically complete on its own (no unterminated quotes or heredocs
waiting for more input).

Before running anything, `bash` also checks the command against a small
deny-list of unambiguously destructive patterns — see
[guardrails.md](guardrails.md#bash-tripwires).

## `grep`

Searches file contents for a regular expression (or a literal string with
`literal: true`), recursively, honoring `.gitignore`. Returns matching lines
as `path:line: text`, capped at 200 matches.

## `find`

Finds files by glob pattern, recursively, honoring `.gitignore`. A pattern
containing `/` matches the full relative path; otherwise just the basename
(mirrors `fd`'s behavior). Capped at 200 results.

## `ls`

Lists files and directories at a given path, non-recursive. Always skips
`.git`, `node_modules`, `dist`, and `.mini`.

## `docs`

Looks up mini's own documentation — this is how mini answers "how do I use
you" or "what does X do" questions about itself, rather than guessing.
Call with no arguments to list available topics, or a topic key (e.g.
`guardrails`, `repl-commands`) to read that doc in full. The content is
embedded into mini at build time, so it works identically whether you're
running from source, via `bun link`, or the compiled `dist/mini` binary.

## Filesystem boundary

`read`, `write`, `edit`, `ls`, `grep`, and `find` are all confined to the
project directory mini was started in — a path that resolves outside that
directory (an absolute `/etc/passwd`, a relative `../../.ssh/id_rsa`) is
rejected before it's ever touched, returned as a normal tool error the model
can recover from. This does **not** cover symlinks planted inside the
project pointing outside it, and it structurally can't cover `bash` —
arbitrary shell can reach anywhere the OS user can, and containing that
needs a real sandbox, which is out of scope for a zero-dependency CLI. See
[guardrails.md](guardrails.md) for the full guardrail picture, including why
`bash` gets a different kind of protection instead.
