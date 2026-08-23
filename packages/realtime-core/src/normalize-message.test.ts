import { describe, expect, it } from "vitest";
import { normalizeMessage } from "./index";

/**
 * Regression tests for the canonical message normalizer (PROJECT_STATUS
 * MESSAGE_CONTRACT_NORMALIZATION). Historical crash: mobile rendered
 * `item.reactions.length` on a raw message.created payload that carried no
 * `reactions` field → "Cannot read property 'length' of undefined".
 */

describe("normalizeMessage", () => {
  it("payload WITHOUT reactions normalizes reactions to []", () => {
    const normalized = normalizeMessage({
      messageId: "m1",
      clientMessageId: "c1",
      conversationId: "conv1",
      senderId: "user-a",
      senderType: "USER",
      sequence: 1,
      type: "TEXT",
      content: "hello",
      createdAt: "2026-08-24T00:00:00.000Z",
    });
    expect(normalized.reactions).toEqual([]);
    expect(normalized.id).toBe("m1");
    expect(normalized.senderName).toBe("user-a"); // falls back to senderId
  });

  it("reactions [] stays [] and valid reactions are preserved", () => {
    expect(normalizeMessage({ messageId: "m", reactions: [] }).reactions).toEqual([]);
    const withReactions = normalizeMessage({
      messageId: "m",
      senderId: "u",
      reactions: [
        { emoji: "👍", userId: "user-a" },
        { emoji: "❤️", userId: "user-b" },
      ],
    });
    expect(withReactions.reactions).toHaveLength(2);
    expect(withReactions.reactions[0]).toEqual({ emoji: "👍", userId: "user-a" });
  });

  it("malformed reaction entries are filtered, never propagated", () => {
    const normalized = normalizeMessage({
      messageId: "m",
      reactions: [{ emoji: "👍", userId: "user-a" }, { emoji: 42 }, null, "junk"],
    });
    expect(normalized.reactions).toEqual([{ emoji: "👍", userId: "user-a" }]);
  });

  it("legacy minimal payload (id + content only) gets safe defaults everywhere", () => {
    const normalized = normalizeMessage({ id: "legacy-1", content: "old row" });
    expect(normalized.reactions).toEqual([]);
    expect(normalized.replyToId).toBeNull();
    expect(normalized.metadata).toBeNull();
    expect(normalized.editedAt).toBeNull();
    expect(normalized.deletedAt).toBeNull();
    expect(normalized.senderType).toBe("USER");
    expect(normalized.type).toBe("TEXT");
    expect(normalized.sequence).toBe(0);
  });

  it("metadata object passes through; non-object metadata becomes null", () => {
    const meta = { storageKey: "media/c/1-x.png", filename: "x.png" };
    expect(normalizeMessage({ messageId: "m", metadata: meta }).metadata).toEqual(meta);
    expect(normalizeMessage({ messageId: "m", metadata: "junk" }).metadata).toBeNull();
    expect(normalizeMessage({ messageId: "m", metadata: null }).metadata).toBeNull();
  });

  it("deleted/edited timestamps normalize to string|null", () => {
    expect(
      normalizeMessage({ messageId: "m", deletedAt: "2026-08-24T01:00:00.000Z" }).deletedAt,
    ).toBe("2026-08-24T01:00:00.000Z");
    expect(normalizeMessage({ messageId: "m", deletedAt: "" }).deletedAt).toBeNull();
    expect(normalizeMessage({ messageId: "m", deletedAt: 5 }).deletedAt).toBeNull();
  });

  it("non-object input does not throw and yields an inert message", () => {
    expect(() => normalizeMessage(null)).not.toThrow();
    expect(() => normalizeMessage("junk")).not.toThrow();
    const inert = normalizeMessage(undefined);
    expect(inert.reactions).toEqual([]);
    expect(inert.id).toBe("");
  });

  it("bot message path uses the same contract (senderType BOT preserved)", () => {
    const botMessage = normalizeMessage({
      messageId: "m-bot",
      senderId: "system-bot",
      senderType: "BOT",
      senderName: "System Bot",
      content: "pong 🏓",
      sequence: 9,
      createdAt: "2026-08-24T00:00:00.000Z",
    });
    expect(botMessage.reactions).toEqual([]);
    expect(botMessage.senderType).toBe("BOT");
    expect(botMessage.senderName).toBe("System Bot");
  });
});
