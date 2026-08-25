// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "../agent/types.js";

interface SessionHeader {
  kind: "header";
  id: string;
  createdAt: string;
  cwd: string;
}

interface SessionMessageEntry {
  kind: "message";
  message: Message;
}

type SessionEntry = SessionHeader | SessionMessageEntry;

function sessionsDir(cwd: string): string {
  return join(cwd, ".mini", "sessions");
}

function sessionPath(cwd: string, id: string): string {
  return join(sessionsDir(cwd), `${id}.jsonl`);
}

export class Session {
  constructor(
    public readonly id: string,
    private readonly filePath: string,
  ) {}

  static async create(cwd: string): Promise<Session> {
    const id = randomUUID();
    await mkdir(sessionsDir(cwd), { recursive: true });
    const filePath = sessionPath(cwd, id);
    const header: SessionHeader = { kind: "header", id, createdAt: new Date().toISOString(), cwd };
    await appendFile(filePath, `${JSON.stringify(header)}\n`, "utf-8");
    return new Session(id, filePath);
  }

  static async resume(cwd: string, id: string): Promise<{ session: Session; messages: Message[] }> {
    const filePath = sessionPath(cwd, id);
    const raw = await readFile(filePath, "utf-8");
    const messages: Message[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.kind === "message") messages.push(entry.message);
    }
    return { session: new Session(id, filePath), messages };
  }

  async appendMessage(message: Message): Promise<void> {
    const entry: SessionMessageEntry = { kind: "message", message };
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf-8");
  }
}

export async function listSessions(cwd: string): Promise<{ id: string; createdAt: string; mtime: Date }[]> {
  const dir = sessionsDir(cwd);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const id = file.slice(0, -".jsonl".length);
    const filePath = join(dir, file);
    try {
      const [raw, fileStat] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
      const firstLine = raw.split("\n", 1)[0];
      const header = JSON.parse(firstLine) as SessionHeader;
      sessions.push({ id, createdAt: header.createdAt, mtime: fileStat.mtime });
    } catch {
      // skip unreadable/corrupt session files
    }
  }
  return sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
