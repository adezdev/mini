# Guardrails

mini is built to be safe to start and walk away from — able to run
unattended without the constant risk of it doing something destructive, and
able to notice and correct its own mistakes rather than needing supervision
on every step. That ruled out one obvious approach: per-tool-call
confirmation prompts require you to be there, which defeats the entire
point of "walk away." Everything here instead either contains the blast
radius of a mistake without needing your attention, or gives mini a way to
notice and fix its own mistakes automatically.

None of this is a sandbox. mini has no container, no seccomp policy, no
network isolation — it runs with your own user's filesystem and shell
access. These guardrails catch honest mistakes (a hallucinated bad path, an
unverified change, an accidentally destructive command), not a
model that's actively trying to work around them.

## Filesystem boundary

`read`, `write`, `edit`, `ls`, `grep`, and `find` all confine their path
arguments to the project directory mini was started in. A resolved path
that escapes it — an absolute `/etc/passwd`, a relative
`../../.ssh/id_rsa` — is rejected before anything touches disk, returned as
a normal tool error so the model can try a narrower path instead of
crashing the session.

Known gaps, on purpose: a symlink planted inside the project pointing
outside it isn't caught (would need a `realpath` check on every call, for a
narrow threat that requires a pre-planted symlink to exploit). And `bash`
can't be filesystem-contained this way at all — arbitrary shell reaches
anywhere the OS user can — which is why it gets the deny-list approach
below instead.

## Checkpointing

If you're in a git repository with a clean working tree, mini commits
whatever a turn changed — one commit per turn, with the repository's normal
hooks running (never skipped with `--no-verify`; a hook is itself a
guardrail). A mistake is one `git revert` away from undone, not buried in a
pile of unrelated diffs.

**Where the commits land** depends on what branch you were already on:

- If you started on the repository's protected default branch (the
  remote's `origin/HEAD` target if there is one, else a local `main` or
  `master` if one exists, else — no established multi-branch convention to
  go on — the branch you're on, since it's the only line of history there
  is) or HEAD is detached, checkpoint commits go on a fresh
  `mini/<session-id-prefix>` branch instead, so nothing lands on your main
  line by accident.
- Otherwise — you were already on some other branch — commits land in
  place, right there. Most real work already happens off a topic branch,
  and if you're on one, you're already treating it as disposable/reviewable
  (you'll PR it, squash it, whatever your workflow is); mini's checkpoints
  just become part of that history.

`--resume`, or starting a fresh session that reuses a saved session id,
reuses that same `mini/` branch if it still exists.

**Requirements and gaps**: needs a clean starting tree — checkpointing
covers mini's own changes, not whatever WIP was already there, so a dirty
tree at session start disables checkpointing for that session (with a
one-line notice) rather than sweeping your existing work into mini's first
commit. Not built, on purpose: auto-squashing, auto-merging into your real
branch, or auto-deleting a branch after a bad run — those all stay a manual
decision on your end.

## Self-check

Whenever a turn's tool calls include a successful `write`, `edit`, or
`bash`, mini automatically runs one more pass telling the model to verify
its own work — run whatever this project's checks are (tests, lint,
typecheck, build, whatever applies) and fix anything broken — before
finishing. mini's harness deliberately doesn't try to know or guess a
project's check command; the model already knows how, from the project's
own instructions file and from having run its own checks earlier in the
session.

This is shown plainly in the transcript, prefixed `[auto self-check]`, not
hidden — you'll see exactly what mini told itself to do. It's bounded to
exactly one self-check pass per turn, even if the check itself changes more
files: it does not chain a second self-check off the first one's own
changes. If the fix turns out wrong, that's what checkpointing is for, not
a retry loop.

Disable with `MINI_SELF_CHECK=0`. It roughly doubles API calls on any turn
that touches files, which is the tradeoff for catching a mistake
immediately instead of finding it later.

## Bash tripwires

Before a `bash` command ever spawns, it's checked against a small,
high-confidence deny-list of unambiguously destructive patterns. This is a
last-resort circuit breaker, not a permission system — there's no in-band
override on the tool call (no `force: true` flag), because a model that
could flip such a flag would just learn to always flip it.

Three checks:

- **Whole-filesystem or home-directory `rm -rf`.** Matches `rm` with both
  recursive and force flags (any order, short or long form) targeting a
  bare `/`, `~`, `$HOME`, `${HOME}`, or `/*` — never a scoped path like
  `rm -rf ./build`.
- **`curl`/`wget` piped into a root shell** (`| sudo sh`, `| sudo bash`,
  etc). Deliberately narrower than blocking all `curl | sh` — that pattern
  alone is an extremely common legitimate installer idiom, and blocking it
  outright would be more friction than protection. The genuinely dangerous
  version is piping a remote script into a *root* shell.
- **Force-pushing the repository's protected default branch**
  (`git push --force`/`-f`/`--force-with-lease`, whether as a bare
  force-push — which defaults to the current branch — or an explicit
  refspec). Uses the same branch-protection resolution as checkpointing.

Disable all three with `MINI_BASH_TRIPWIRES=0`, set before the session
starts. This guards against an honest mistake — a hallucinated bad path or
command — not a determined attempt to obfuscate around it (quoting tricks,
command substitution, encoded payloads); that needs a real sandbox, out of
scope here.

## Context usage warning

mini has no automatic history pruning beyond the manual `/compact`/`/clear`
commands. Once a turn's prompt token count crosses 80% of the current
model's context window (checked against the same cached model list `/cost`
uses), the REPL prints a one-line nudge toward `/compact` instead of
silently running until the provider errors out mid-task. Fires once per
session and re-arms on `/clear`/`/compact`.

## Turn cap

The agent loop stops after `MINI_MAX_TURNS` tool-call rounds within a
single user turn (default 30) so a runaway tool-call loop can't run
forever. Raise it for a task that genuinely needs more room.
