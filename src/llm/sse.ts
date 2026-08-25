// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

/**
 * Minimal Server-Sent-Events line reader for OpenAI-compatible streaming
 * responses. Consumes a fetch() body stream and yields parsed JSON payloads
 * from each `data: {...}` line, stopping (without yielding) on `data: [DONE]`.
 */
export async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "" || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        if (payload === "") continue;

        try {
          yield JSON.parse(payload);
        } catch {
          // Ignore malformed lines (e.g. comment/heartbeat frames).
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
