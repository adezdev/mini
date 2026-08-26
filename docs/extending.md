# Extending mini with custom tools

mini can add tools to itself without a source change or a restart: drop an
`AgentTool`-shaped file into `.mini/tools/` and it's picked up on the next
turn.

## Where they live

`.mini/tools/*.ts` (or `.js`), relative to the project root mini was
started in. The directory doesn't need to exist ahead of time — `write`
creates it the same way it creates any other missing directory.

## The shape

```ts
import type { AgentTool } from "mini/agent/types"; // illustrative — see below

const tool: AgentTool = {
  name: "word-count",
  description: "Counts words in a string.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to count words in." },
    },
    required: ["text"],
  },
  async execute(args: { text: string }) {
    const count = args.text.trim().split(/\s+/).filter(Boolean).length;
    return { content: `${count} words` };
  },
};

export default tool;
```

- Export the tool as `default` or as a named `tool` export.
- `name` must match `/^[a-zA-Z0-9_-]{1,64}$/` and can't collide with a
  built-in tool's name (`read`, `write`, `edit`, `bash`, `grep`, `find`,
  `ls`, `docs`) — built-ins always win.
- `parameters` is a JSON Schema object, same as any built-in tool's.
- `execute(args, cwd, signal)` returns `{ content: string, isError?: boolean }`.
  Throwing is also fine — mini catches it and reports the error to the
  model rather than crashing.

Don't actually import `AgentTool` from `mini/agent/types` — that's not a
published package. Just match the shape; mini duck-types it at load time
rather than requiring a real import, so a dynamic tool file has no
compile-time dependency on mini's own source.

## Reload timing

There's no dedicated "reload" tool or command. mini rescans `.mini/tools/`
before every pass through the agent loop — the same turn you write or edit
a tool file, the file exists on disk in time for the *next* pass (the
self-check pass that follows a file-changing turn counts) to see it. You
never need to restart the process.

## Verifying a tool file before it's loaded

Don't sanity-check a `.ts` tool file with plain `node --check` (or `node
file.ts`) — Node's own parser doesn't understand TypeScript syntax and
will fail on the first type annotation (e.g. `const tool: AgentTool = {`)
with something like `SyntaxError: Missing initializer in const
declaration`. That error is about Node, not your file — mini loads
`.mini/tools/` through Bun's own runtime TS transpiler (same as it runs
the rest of mini's own source), which handles a plain type annotation
fine. Seeing a `node --check` failure on a `.ts` tool file is not evidence
the file is broken; don't "fix" it by rewriting to JS in response to that
error alone. If you want to verify it compiles/imports cleanly before
relying on it, load it the same way mini does — `bun -e 'import("./.mini/tools/your-tool.ts").then(console.log)'`
— rather than reaching for a checker mini itself doesn't use.

## Trust boundary

A dynamic tool's `execute` runs with the same privilege as the `bash`
tool: full filesystem and process access, no path confinement, no
tripwire checks unless you add your own inside the tool. Writing a tool
file is exactly as consequential as running a shell command — mini
doesn't add a second sandbox around code it wrote for itself.

## Version control

`.mini/` is gitignored by default (session logs, mostly), except
`.mini/tools/`, which is carved out specifically so tools you or mini
write are real, committable project files. That carve-out is just the
gitignore, though — mini's own auto-checkpoint commits exclude all of
`.mini/` regardless (see [guardrails.md](guardrails.md#checkpointing)), so
a new tool file still needs an explicit `git add .mini/tools/your-tool.ts`
to actually land in history.
