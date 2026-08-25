// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

export interface ParsedArgs {
  model?: string;
  resume?: string;
  print?: string;
  listSessions: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { listSessions: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--model":
        result.model = argv[++i];
        break;
      case "--resume":
        result.resume = argv[++i];
        break;
      case "-p":
      case "--print":
        result.print = argv[++i];
        break;
      case "--list-sessions":
        result.listSessions = true;
        break;
      case "-h":
      case "--help":
        result.help = true;
        break;
      default:
        if (!result.print && !arg.startsWith("-")) {
          // Allow `mini "do the thing"` as shorthand for -p.
          result.print = arg;
        }
    }
  }
  return result;
}
