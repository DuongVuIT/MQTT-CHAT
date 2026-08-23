/**
 * Bot command parser.
 * Supports: command, args, quoted args, aliases, validation-friendly output.
 *
 *   "/ping"            → { command: "ping", args: [] }
 *   "/status bob"      → { command: "status", args: ["bob"] }
 *   '/say "hello bot"' → { command: "say", args: ["hello bot"] }
 */

export interface ParsedCommand {
  command: string;
  args: string[];
  raw: string;
}

export interface CommandParserOptions {
  prefix?: string;
  /** Aliases map e.g. { h: "help" }. */
  aliases?: Record<string, string>;
}

export function parseCommand(
  input: string,
  options: CommandParserOptions = {},
): ParsedCommand | null {
  const prefix = options.prefix ?? "/";
  const trimmed = input.trim();
  if (!trimmed.startsWith(prefix)) return null;

  const body = trimmed.slice(prefix.length).trim();
  if (body.length === 0) return null;

  // Tokenize with support for double/single-quoted args.
  const tokens: string[] = [];
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(body)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }

  const [rawToken = "", ...args] = tokens;
  const rawCommand = rawToken.toLowerCase().replace(/:+$/, "");

  const aliasMap = options.aliases ?? {};
  const command = aliasMap[rawCommand] ?? rawCommand;

  return { command, args, raw: trimmed };
}
