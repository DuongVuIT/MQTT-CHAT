import { describe, expect, it } from "vitest";
import { parseCommand } from "./command-parser";

describe("parseCommand", () => {
  it("parses a simple command", () => {
    expect(parseCommand("/ping")).toEqual({ command: "ping", args: [], raw: "/ping" });
  });

  it("parses command with args", () => {
    expect(parseCommand("/status bob")).toEqual({
      command: "status",
      args: ["bob"],
      raw: "/status bob",
    });
  });

  it("supports quoted args", () => {
    expect(parseCommand('/say "hello world"')).toEqual({
      command: "say",
      args: ["hello world"],
      raw: '/say "hello world"',
    });
  });

  it("is case-insensitive for command name", () => {
    expect(parseCommand("/PING")?.command).toBe("ping");
  });

  it("resolves aliases", () => {
    expect(parseCommand("/h", { aliases: { h: "help" } })?.command).toBe("help");
  });

  it("returns null for non-commands", () => {
    expect(parseCommand("hello bot")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for bare slash", () => {
    expect(parseCommand("/")).toBeNull();
  });
});
