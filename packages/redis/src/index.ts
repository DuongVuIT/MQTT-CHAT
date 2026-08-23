import { Redis } from "ioredis";
import { redisKeys } from "./keys";

export * from "./keys";

/**
 * Redis client factory + state repositories:
 * presence (multi-device), typing (ephemeral), unread counters,
 * bot transient state, cooldowns, distributed locks.
 */

export type RedisClient = Redis;

export function createRedisClient(url: string): RedisClient {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
  return client;
}

export async function closeRedisClient(client: RedisClient): Promise<void> {
  await client.quit().catch(() => {
    client.disconnect();
  });
}

export interface PresenceInfo {
  online: boolean;
  connectionCount: number;
  devices: string[];
  lastSeenAt: string | null;
}

/** Multi-device presence repository. A user is offline only when no active connection remains. */
export class PresenceRepository {
  constructor(private readonly redis: RedisClient) {}

  /** Register a device connection. Returns updated presence. */
  async addConnection(userId: string, deviceId: string): Promise<PresenceInfo> {
    const now = new Date().toISOString();
    const connKey = redisKeys.connection(userId, deviceId);
    await this.redis.set(connKey, now);
    await this.redis.sadd(redisKeys.presenceUser(userId), deviceId);
    return this.getPresence(userId);
  }

  /** Remove a device connection. Returns updated presence. */
  async removeConnection(userId: string, deviceId: string): Promise<PresenceInfo> {
    const connKey = redisKeys.connection(userId, deviceId);
    await this.redis.del(connKey);
    await this.redis.srem(redisKeys.presenceUser(userId), deviceId);
    const info = await this.getPresence(userId);
    if (!info.online) {
      // Persist last-seen in a dedicated key — NEVER overwrite the presence
      // set itself: flipping its Redis type (set → string) makes the next
      // SADD/SMEMBERS fail with WRONGTYPE and bricks presence for the user.
      await this.redis
        .set(redisKeys.presenceLastSeen(userId), new Date().toISOString())
        .catch(() => undefined);
      // Drop the empty set so the keyspace stays type-consistent.
      await this.redis.del(redisKeys.presenceUser(userId)).catch(() => undefined);
    }
    return info;
  }

  async getPresence(userId: string): Promise<PresenceInfo> {
    const devices = await this.redis.smembers(redisKeys.presenceUser(userId));
    if (devices.length === 0) {
      const lastSeenAt = await this.redis.get(redisKeys.presenceLastSeen(userId));
      return { online: false, connectionCount: 0, devices: [], lastSeenAt };
    }
    return { online: true, connectionCount: devices.length, devices, lastSeenAt: null };
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(redisKeys.presenceUser(userId))) > 0;
  }

  /** Touch last activity for a user (used by bot tracking / admin). */
  async touchActivity(userId: string): Promise<void> {
    await this.redis.set(`activity:user:${userId}`, new Date().toISOString());
  }

  async getLastActivity(userId: string): Promise<string | null> {
    return this.redis.get(`activity:user:${userId}`);
  }
}

const TYPING_TTL_SECONDS = 8;

/** Ephemeral typing state with TTL — never persisted to PostgreSQL. */
export class TypingRepository {
  constructor(private readonly redis: RedisClient) {}

  async setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const key = redisKeys.typingConversationUser(conversationId, userId);
    if (isTyping) {
      await this.redis.set(key, "1", "EX", TYPING_TTL_SECONDS);
    } else {
      await this.redis.del(key);
    }
  }

  /** Refresh TTL without changing value (client keeps typing). */
  async refreshTyping(conversationId: string, userId: string): Promise<void> {
    const key = redisKeys.typingConversationUser(conversationId, userId);
    await this.redis.expire(key, TYPING_TTL_SECONDS);
  }

  async getTypingUsers(conversationId: string, excludeUserId?: string): Promise<string[]> {
    const pattern = `typing:conversation:${conversationId}:user:*`;
    const keys = await this.scanKeys(pattern);
    const users: string[] = [];
    for (const key of keys) {
      const userId = key.split(":user:")[1];
      if (!userId || userId === excludeUserId) continue;
      users.push(decodeURIComponent(userId));
    }
    return users;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    return keys;
  }
}

/** Unread message counters per user/conversation. */
export class UnreadRepository {
  constructor(private readonly redis: RedisClient) {}

  async increment(userId: string, conversationId: string): Promise<void> {
    await this.redis.incr(redisKeys.unreadUserConversation(userId, conversationId));
  }

  async reset(userId: string, conversationId: string): Promise<void> {
    await this.redis.del(redisKeys.unreadUserConversation(userId, conversationId));
  }

  async get(userId: string, conversationId: string): Promise<number> {
    const value = await this.redis.get(redisKeys.unreadUserConversation(userId, conversationId));
    return value ? Number.parseInt(value, 10) : 0;
  }
}

/** Bot transient state scoped by bot/conversation/user + cooldowns. */
export class BotStateRepository {
  constructor(
    private readonly redis: RedisClient,
    private readonly defaultStateTtlSeconds = 60 * 30,
  ) {}

  async getState<T>(botId: string, scopeKey: string): Promise<T | null> {
    const raw = await this.redis.get(`bot:state:${botId}:${scopeKey}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setState(botId: string, scopeKey: string, state: unknown): Promise<void> {
    await this.redis.set(
      `bot:state:${botId}:${scopeKey}`,
      JSON.stringify(state),
      "EX",
      this.defaultStateTtlSeconds,
    );
  }

  async deleteState(botId: string, scopeKey: string): Promise<void> {
    await this.redis.del(`bot:state:${botId}:${scopeKey}`);
  }

  incrementCounter(botId: string, scopeKey: string, field: string): Promise<number> {
    return this.redis.hincrby(`bot:state:${botId}:${scopeKey}`, field, 1);
  }

  /** Cooldown guard: returns true if allowed (and sets the cooldown), false if still cooling down. */
  async tryAcquireCooldown(
    botId: string,
    ruleId: string,
    userId: string,
    cooldownSeconds: number,
  ): Promise<boolean> {
    const key = redisKeys.botCooldownRuleUser(botId, ruleId, userId);
    const result = await this.redis.set(key, "1", "EX", cooldownSeconds, "NX");
    return result === "OK";
  }
}

const NOTIFICATION_AUDIT_TTL_SECONDS = 60 * 10;

/** Delivery audit trail for the notification-worker (short TTL, observable in E2E). */
export class NotificationDeliveryRepository {
  constructor(private readonly redis: RedisClient) {}

  async recordDelivery(
    recipientId: string,
    messageId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.redis.set(
      redisKeys.notificationDelivered(recipientId, messageId),
      JSON.stringify({ ...payload, deliveredAt: new Date().toISOString() }),
      "EX",
      NOTIFICATION_AUDIT_TTL_SECONDS,
    );
  }

  async getDelivery(
    recipientId: string,
    messageId: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(redisKeys.notificationDelivered(recipientId, messageId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Simple distributed lock using SET NX EX. */
export async function acquireLock(
  redis: RedisClient,
  name: string,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis.set(redisKeys.lock(name), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function releaseLock(redis: RedisClient, name: string): Promise<void> {
  await redis.del(redisKeys.lock(name));
}
