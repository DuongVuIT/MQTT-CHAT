import { Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  PresenceRepository,
  closeRedisClient,
  createRedisClient,
  type RedisClient,
} from "@mqtt-chat/redis";
import { loadServerEnv } from "@mqtt-chat/config";

/**
 * Global Redis service for the API process — read-side access to shared
 * ephemeral state (presence) written by chat-worker. The API never writes
 * presence; it only projects what the authoritative worker maintains.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClient | null = null;
  private readonly presenceRepo: PresenceRepository;

  constructor() {
    const env = loadServerEnv();
    this.client = createRedisClient(env.REDIS_URL);
    this.presenceRepo = new PresenceRepository(this.client);
  }

  get presence(): PresenceRepository {
    return this.presenceRepo;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await closeRedisClient(this.client);
  }
}
