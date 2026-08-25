// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { spawn } from "node:child_process";
import type { AgentTool } from "../agent/types.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export const bashTool: AgentTool = {
  name: "bash",
  description:
    "Execute a shell command in the working directory. Returns merged stdout+stderr. " +
    "Use for running builds, tests, listing files, git commands, etc.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run." },
      timeout: { type: "number", description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).` },
    },
    required: ["command"],
  },
  async execute(args: { command: string; timeout?: number }, cwd: string) {
    const timeoutMs = args.timeout ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolvePromise) => {
      const child = spawn(args.command, {
        cwd,
        shell: true,
        env: process.env,
        // Lets us kill the whole process group on timeout, not just the shell: a
        // plain child.kill() only signals the shell, and if the shell forked a
        // real child instead of exec-replacing itself, that child keeps the
        // stdout pipe open and `close` never fires until it exits on its own.
        detached: process.platform !== "win32",
      });

      let output = "";
      let truncated = false;
      let timedOut = false;

      const append = (chunk: Buffer) => {
        if (truncated) return;
        output += chunk.toString("utf-8");
        if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
          output = `${output.slice(0, MAX_OUTPUT_BYTES)}\n[... output truncated ...]`;
          truncated = true;
        }
      };

      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise({ content: `Failed to start command: ${err.message}`, isError: true });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolvePromise({ content: `${output}\n[Command timed out after ${timeoutMs}ms]`, isError: true });
          return;
        }
        if (code !== 0) {
          resolvePromise({ content: `${output}\n[Exit code ${code}]`, isError: true });
          return;
        }
        resolvePromise({ content: output || "(no output)" });
      });
    });
  },
};
