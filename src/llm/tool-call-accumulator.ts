// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface AccumulatedToolCall {
  id: string;
  name: string;
  args: unknown;
  /** true if the JSON args could not be parsed (e.g. truncated by finish_reason "length"). */
  malformed: boolean;
}

/**
 * OpenAI-compatible streaming responses split each tool call's arguments
 * across many chunks, addressed by a stable numeric `index` (not by id,
 * which may only appear on the first chunk for that index). This class
 * accumulates those fragments and produces finished tool calls once the
 * stream signals completion.
 */
export class ToolCallAccumulator {
  private blocks = new Map<number, { id: string; name: string; argsBuffer: string }>();

  addDelta(delta: ToolCallDelta): void {
    let block = this.blocks.get(delta.index);
    if (!block) {
      block = { id: delta.id ?? "", name: delta.function?.name ?? "", argsBuffer: "" };
      this.blocks.set(delta.index, block);
    } else {
      if (delta.id) block.id = delta.id;
      if (delta.function?.name) block.name = delta.function.name;
    }
    if (delta.function?.arguments) {
      block.argsBuffer += delta.function.arguments;
    }
  }

  isEmpty(): boolean {
    return this.blocks.size === 0;
  }

  finalize(): AccumulatedToolCall[] {
    const result: AccumulatedToolCall[] = [];
    for (const [index, block] of [...this.blocks.entries()].sort((a, b) => a[0] - b[0])) {
      let args: unknown;
      let malformed = false;
      try {
        args = block.argsBuffer.trim() === "" ? {} : JSON.parse(block.argsBuffer);
      } catch {
        args = {};
        malformed = true;
      }
      result.push({
        id: block.id || `call_${index}`,
        name: block.name,
        args,
        malformed,
      });
    }
    return result;
  }
}
