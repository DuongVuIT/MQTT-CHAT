/**
 * Centralized Redis key builders.
 * NEVER hardcode Redis keys in applications — always use these builders.
 */

export const redisKeys = {
  presenceUser: (userId: string): string => `presence:user:${userId}`,

  /** Last-seen timestamp for a fully-offline user (kept separate so the
   *  presence set above never changes its Redis type). */
  presenceLastSeen: (userId: string): string => `presence:lastseen:${userId}`,

  connection: (userId: string, deviceId: string): string => `connection:user:${userId}:${deviceId}`,

  typingConversationUser: (conversationId: string, userId: string): string =>
    `typing:conversation:${conversationId}:user:${userId}`,

  unreadUserConversation: (userId: string, conversationId: string): string =>
    `unread:user:${userId}:conversation:${conversationId}`,

  botStateUser: (botId: string, userId: string): string => `bot:state:${botId}:user:${userId}`,

  botSessionConversationUser: (botId: string, conversationId: string, userId: string): string =>
    `bot:session:${botId}:${conversationId}:${userId}`,

  botCooldownRuleUser: (botId: string, ruleId: string, userId: string): string =>
    `bot:cooldown:${botId}:${ruleId}:${userId}`,

  /** Notification delivery audit (per recipient, short TTL). */
  notificationDelivered: (recipientId: string, messageId: string): string =>
    `notify:delivered:${recipientId}:${messageId}`,

  /** Generic distributed lock. */
  lock: (name: string): string => `lock:${name}`,
} as const;
