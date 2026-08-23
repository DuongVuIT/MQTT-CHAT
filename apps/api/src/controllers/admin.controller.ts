import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { apiError } from "../common";

/**
 * Admin statistics endpoints (consumed by the /admin dashboard).
 * Live event streaming is done via MQTT in the dashboard; these endpoints
 * provide aggregate/persisted data. Response shapes are the dashboard
 * contract — nested `stats` object and per-user presence fields.
 */

@Controller("admin")
export class AdminController {
  // Explicit tokens: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get("stats")
  async stats() {
    const minuteAgo = new Date(Date.now() - 60_000);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const [userTotal, conversationsTotal, messagesTotal, messagesLastMinute, bots, eventsLastHour] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.conversation.count(),
        this.prisma.message.count(),
        this.prisma.message.count({ where: { createdAt: { gte: minuteAgo } } }),
        this.prisma.bot.findMany({ select: { enabled: true } }),
        this.prisma.outboxEvent.count({ where: { createdAt: { gte: hourAgo } } }),
      ]);

    // Online = server-authoritative Redis presence written by chat-worker.
    const allUsers = await this.prisma.user.findMany({ select: { id: true } });
    const presenceFlags = await Promise.all(
      allUsers.map(async (u) => (await this.redis.presence.getPresence(u.id)).online),
    );
    const usersOnline = presenceFlags.filter(Boolean).length;

    return {
      stats: {
        users: { total: userTotal, online: usersOnline },
        conversations: { total: conversationsTotal },
        messages: { total: messagesTotal, perMinute: messagesLastMinute },
        bots: {
          total: bots.length,
          enabled: bots.filter((b) => b.enabled).length,
        },
        events: { lastHour: eventsLastHour },
      },
    };
  }

  @Get("users")
  async users() {
    const rows = await this.prisma.user.findMany({
      include: {
        devices: { select: { clientId: true, lastSeenAt: true } },
        _count: { select: { messages: true } },
      },
    });
    const enriched = await Promise.all(
      rows.map(async (u) => {
        const presence = await this.redis.presence.getPresence(u.id);
        return {
          id: u.id,
          displayName: u.displayName,
          online: presence.online,
          connectionCount: presence.connectionCount,
          devices: u.devices,
          deviceCount: Math.max(u.devices.length, presence.connectionCount),
          lastActivityAt:
            u.devices
              .map((d) => d.lastSeenAt)
              .filter((d): d is Date => Boolean(d))
              .sort()
              .at(-1)
              ?.toISOString() ?? null,
          messagesSent: u._count.messages,
        };
      }),
    );
    return { users: enriched };
  }

  @Get("events")
  async events(@Query("eventType") eventType?: string, @Query("limit") limit?: string) {
    const parsedLimit = Math.min(Math.max(Number.parseInt(limit ?? "100", 10) || 100, 1), 500);
    const events = await this.prisma.outboxEvent.findMany({
      where: eventType ? { eventType } : undefined,
      orderBy: { createdAt: "desc" },
      take: parsedLimit,
    });
    return { events };
  }

  @Get("bots/:id/logs")
  async botLogs(@Param("id") id: string) {
    const bot = await this.prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundException(apiError("BOT_NOT_FOUND", "Bot not found"));
    const [eventLogs, commandLogs, executionLogs] = await Promise.all([
      this.prisma.botEventLog.findMany({
        where: { botId: id },
        orderBy: { processedAt: "desc" },
        take: 50,
      }),
      this.prisma.botCommandLog.findMany({
        where: { botId: id },
        orderBy: { executedAt: "desc" },
        take: 50,
      }),
      this.prisma.botExecutionLog.findMany({
        where: { botId: id },
        orderBy: { executedAt: "desc" },
        take: 50,
      }),
    ]);
    return { eventLogs, commandLogs, executionLogs };
  }
}
