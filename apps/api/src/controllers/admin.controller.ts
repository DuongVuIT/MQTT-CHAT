import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { apiError } from "../common";

/**
 * Admin statistics endpoints (consumed by apps/admin).
 * Live event streaming is done via MQTT in the admin app; these endpoints
 * provide aggregate/persisted data.
 */

@Controller("admin")
export class AdminController {
  // Explicit token: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("stats")
  async stats() {
    const since = new Date(Date.now() - 60_000);
    const [users, conversations, messages, messagesLastMinute, bots, outboxPending] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.conversation.count(),
        this.prisma.message.count(),
        this.prisma.message.count({ where: { createdAt: { gte: since } } }),
        this.prisma.bot.findMany({ select: { id: true, name: true, enabled: true } }),
        this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
      ]);

    return {
      users,
      conversations,
      messages,
      messagesPerMinute: messagesLastMinute,
      bots,
      outboxPending,
    };
  }

  @Get("users")
  async users() {
    const users = await this.prisma.user.findMany({
      include: {
        devices: { select: { clientId: true, lastSeenAt: true } },
        memberships: { select: { conversationId: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        _count: { select: { messages: true } },
      },
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        deviceCount: u.devices.length,
        devices: u.devices,
        conversationCount: u.memberships.length,
        messageCount: u._count.messages,
        lastMessageAt: u.messages[0]?.createdAt ?? null,
      })),
    };
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
