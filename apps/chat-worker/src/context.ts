import type { PrismaClient } from "@mqtt-chat/database";
import type { Logger } from "@mqtt-chat/logger";
import type { MqttClient } from "@mqtt-chat/mqtt";
import type {
  PresenceRepository,
  RedisClient,
  TypingRepository,
  UnreadRepository,
} from "@mqtt-chat/redis";

/**
 * Shared dependencies for chat-worker handlers (thin dependency injection).
 */

export interface WorkerContext {
  db: PrismaClient;
  mqtt: MqttClient;
  redis: RedisClient;
  presence: PresenceRepository;
  typing: TypingRepository;
  unread: UnreadRepository;
  log: Logger;
}
