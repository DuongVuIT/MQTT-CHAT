import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";

/**
 * Health model — reports REAL dependency state, never a hardcoded healthy.
 * Public path: GET /api/health (via the gateway).
 */
@Controller("health")
export class HealthController {
  // Explicit tokens: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get()
  async health(): Promise<{ service: string; status: string; database: string; redis: string }> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.redis.ping()]);
    const degraded = database !== "up" || redis !== "up";
    return {
      service: "mqtt-chat-api",
      status: degraded ? "degraded" : "ok",
      database,
      redis,
    };
  }

  private async checkDatabase(): Promise<"up" | "down"> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "up";
    } catch {
      return "down";
    }
  }
}
