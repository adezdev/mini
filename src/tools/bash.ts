// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { type ChildProcess, spawn } from "node:child_process";
import type { AgentTool } from "../agent/types.js";
import { checkTripwire, tripwiresEnabled } from "./tripwires.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const SHELL = process.env.SHELL || "/bin/bash";

interface RunResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted?: boolean;
  spawnError?: string;
}

/**
 * One shell process kept alive for the life of the tool instance, so `cd` and
 * exported env vars persist across calls instead of resetting every command.
 * Commands are framed with a sentinel line so we know where output ends and
 * can recover the exit code without a wrapper process per call.
 *
 * A timeout kills the shell outright rather than trying to interrupt just the
 * foreground job: that needs real job control (a pty, or non-portable tools
 * like setsid), and mini has neither. The next call transparently respawns.
 */
class PersistentShell {
  private child: ChildProcess | null = null;
  private cwd: string | null = null;
  private buffer = "";
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  run(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
    const result = this.queue.then(() => this.runExclusive(command, cwd, timeoutMs, signal));
    this.queue = result.catch(() => {});
    return result;
  }

  private respawn(cwd: string): ChildProcess {
    this.kill();
    const child = spawn(SHELL, [], {
      cwd,
      env: process.env,
      // Own process group so a timeout kill takes the shell and anything it
      // spawned with it, not just the shell itself.
      detached: process.platform !== "win32",
    });
    // Fold stderr into stdout at the source: two independently-drained pipes
    // give no ordering guarantee between them.
    child.stdin?.write("exec 2>&1\n");
    child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
    });
    child.on("error", () => {
      if (this.child === child) this.child = null;
    });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
    this.cwd = cwd;
    return child;
  }

  private runExclusive(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
    const needsRespawn = !this.child || this.child.exitCode !== null || this.cwd !== cwd;
    const child = needsRespawn ? this.respawn(cwd) : (this.child as ChildProcess);
    const token = `__MINI_EOC_${++this.seq}__`;
    this.buffer = "";

    return new Promise<RunResult>((resolve) => {
      let settled = false;
      const finish = (result: RunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.off("error", onError);
        child.off("exit", onExit);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onError = (err: Error) => {
        if (this.child === child) this.child = null;
        finish({ output: "", exitCode: null, timedOut: false, spawnError: err.message });
      };

      // A command like `exit 3` terminates the shell itself, so the sentinel
      // echo queued right after it never runs. Fall back to the process's
      // own exit code in that case instead of hanging until timeout.
      const onExit = (code: number | null) => {
        finish({ output: this.buffer, exitCode: code, timedOut: false });
      };

      const onData = () => {
        const markerStart = this.buffer.indexOf(`${token}:`);
        if (markerStart === -1) return;
        const rest = this.buffer.slice(markerStart + token.length + 1);
        const newline = rest.indexOf("\n");
        if (newline === -1) return; // exit code line hasn't fully arrived yet
        const code = Number.parseInt(rest.slice(0, newline), 10);
        finish({
          output: this.buffer.slice(0, markerStart),
          exitCode: Number.isNaN(code) ? null : code,
          timedOut: false,
        });
      };

      // Same shortcoming as the timeout below: no pty/job control means we
      // can't interrupt just the foreground command, so Ctrl+C takes the
      // whole shell with it. The next call respawns transparently.
      const onAbort = () => {
        finish({ output: this.buffer, exitCode: null, timedOut: false, aborted: true });
        this.kill();
      };

      const timer = setTimeout(() => {
        finish({ output: this.buffer, exitCode: null, timedOut: true });
        this.kill();
      }, timeoutMs);

      child.on("error", onError);
      child.on("exit", onExit);
      child.stdout?.on("data", onData);
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin?.write(`${command}\necho "${token}:$?"\n`, (err) => {
        if (err) onError(err);
      });
      onData(); // in case the marker already arrived synchronously
    });
  }

  kill(): void {
    const child = this.child;
    this.child = null;
    if (!child || child.pid == null) return;
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
        // fall through to killing just the child
      }
    }
    child.kill("SIGKILL");
  }
}

function truncate(output: string): string {
  if (Buffer.byteLength(output, "utf-8") <= MAX_OUTPUT_BYTES) return output;
  return `${output.slice(0, MAX_OUTPUT_BYTES)}\n[... output truncated ...]`;
}

const shell = new PersistentShell();

export const bashTool: AgentTool = {
  name: "bash",
  description:
    "Execute a shell command. Runs in a persistent shell for this session, so `cd` and " +
    "exported environment variables carry over between calls. Returns merged stdout+stderr. " +
    "Use for running builds, tests, listing files, git commands, etc. Each command must be " +
    "syntactically complete on its own (no unterminated quotes/heredocs).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run." },
      timeout: { type: "number", description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).` },
    },
    required: ["command"],
  },
  async execute(args: { command: string; timeout?: number }, cwd: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (tripwiresEnabled()) {
      const tripped = await checkTripwire(args.command, cwd);
      if (tripped) return { content: tripped, isError: true };
    }

    const timeoutMs = args.timeout ?? DEFAULT_TIMEOUT_MS;
    const result = await shell.run(args.command, cwd, timeoutMs, signal);

    if (result.aborted) {
      signal?.throwIfAborted();
    }
    if (result.spawnError) {
      return { content: `Failed to start command: ${result.spawnError}`, isError: true };
    }
    if (result.timedOut) {
      return {
        content: `${truncate(result.output)}\n[Command timed out after ${timeoutMs}ms — shell session reset, cwd/env state lost]`,
        isError: true,
      };
    }
    if (result.exitCode !== 0) {
      return { content: `${truncate(result.output) || "(no output)"}\n[Exit code ${result.exitCode}]`, isError: true };
    }
    return { content: truncate(result.output) || "(no output)" };
  },
};

/** Test-only: kills the shared shell so the next call respawns clean. */
export function __resetBashShellForTests(): void {
  shell.kill();
}

process.on("exit", () => shell.kill());
