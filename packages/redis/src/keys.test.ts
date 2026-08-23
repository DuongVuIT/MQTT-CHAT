import { describe, expect, it } from "vitest";
import { redisKeys } from "./keys";

describe("redisKeys", () => {
  it("builds presence keys", () => {
    expect(redisKeys.presenceUser("duong")).toBe("presence:user:duong");
    expect(redisKeys.connection("duong", "web-01")).toBe("connection:user:duong:web-01");
  });

  it("builds typing keys", () => {
    expect(redisKeys.typingConversationUser("conv1", "alice")).toBe(
      "typing:conversation:conv1:user:alice",
    );
  });

  it("builds unread keys", () => {
    expect(redisKeys.unreadUserConversation("bob", "conv2")).toBe(
      "unread:user:bob:conversation:conv2",
    );
  });

  it("builds bot keys", () => {
    expect(redisKeys.botCooldownRuleUser("system-bot", "welcome", "duong")).toBe(
      "bot:cooldown:system-bot:welcome:duong",
    );
  });
});
