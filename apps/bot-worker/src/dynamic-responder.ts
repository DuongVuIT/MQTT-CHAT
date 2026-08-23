import type { PrismaClient } from "@mqtt-chat/database";
import type { PresenceRepository } from "@mqtt-chat/redis";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";
import type { MqttBotTransport } from "./transport";

/**
 * Dynamic responders for actions that need live system data:
 *   reply_status → user presence/activity
 *   reply_users  → user list
 *   reply_stats  → system statistics
 *   reply_room   → current conversation info
 */

export class DynamicResponder {
  constructor(
    private readonly db: PrismaClient,
    private readonly transport: MqttBotTransport,
    private readonly presence: PresenceRepository,
  ) {}

  async respond(
    actionType: string,
    botId: string,
    envelope: EventEnvelope,
    args: string[],
    ruleId?: string,
  ): Promise<boolean> {
    const conversationId = envelope.conversationId ?? "";
    switch (actionType) {
      case "reply_status": {
        const target = args[0];
        if (!target) {
          await this.transport.sendBotCommand({
            conversationId,
            content: "Cách dùng: /status <user>",
            causationId: envelope.eventId,
            ruleId,
          });
          return true;
        }
        const user = await this.db.user.findUnique({ where: { id: target } });
        if (!user) {
          await this.transport.sendBotCommand({
            conversationId,
            content: `Không tìm thấy user "${target}"`,
            causationId: envelope.eventId,
            ruleId,
          });
          return true;
        }
        const info = await this.presence.getPresence(target);
        const lastActivity = await this.presence.getLastActivity(target);
        const messageCount = await this.db.message.count({ where: { senderId: target } });
        const lines = [
          `Trạng thái của ${user.displayName}:`,
          `• Online: ${info.online ? "✅" : "❌"} (${info.connectionCount} device(s))`,
          `• Devices: ${info.devices.join(", ") || "—"}`,
          `• Last activity: ${lastActivity ?? "—"}`,
          `• Số message đã gửi: ${messageCount}`,
        ];
        await this.transport.sendBotCommand({
          conversationId,
          content: lines.join(String.fromCharCode(10)),
          causationId: envelope.eventId,
          ruleId,
        });
        return true;
      }
      case "reply_users": {
        const users = await this.db.user.findMany({ orderBy: { createdAt: "asc" } });
        const lines = await Promise.all(
          users.map(async (u) => {
            const online = await this.presence.isOnline(u.id);
            return `${online ? "🟢" : "⚪"} ${u.displayName} (${u.id})`;
          }),
        );
        await this.transport.sendBotCommand({
          conversationId,
          content: ["Danh sách user:", ...lines].join(String.fromCharCode(10)),
          causationId: envelope.eventId,
          ruleId,
        });
        return true;
      }
      case "reply_stats": {
        const [users, conversations, messages] = await Promise.all([
          this.db.user.count(),
          this.db.conversation.count(),
          this.db.message.count(),
        ]);
        await this.transport.sendBotCommand({
          conversationId,
          content: [
            "Thống kê hệ thống:",
            `• Users: ${users}`,
            `• Conversations: ${conversations}`,
            `• Messages: ${messages}`,
          ].join(String.fromCharCode(10)),
          causationId: envelope.eventId,
          ruleId,
        });
        return true;
      }
      case "reply_room": {
        if (!envelope.conversationId) return true;
        const conversation = await this.db.conversation.findUnique({
          where: { id: envelope.conversationId },
          include: { members: { include: { user: true } }, _count: { select: { messages: true } } },
        });
        if (!conversation) return true;
        const members = conversation.members.map((m) => m.user.displayName).join(", ");
        await this.transport.sendBotCommand({
          conversationId,
          content: [
            `Phòng: ${conversation.title ?? conversation.id}`,
            `Loại: ${conversation.type}`,
            `Thành viên: ${members}`,
            `Số message: ${conversation._count.messages}`,
          ].join(String.fromCharCode(10)),
          causationId: envelope.eventId,
          ruleId,
        });
        return true;
      }
      default:
        return false;
    }
  }

  /** Extract command args from a message.created envelope. */
  static extractArgs(envelope: EventEnvelope): string[] {
    if (
      envelope.eventType !== "message.created" ||
      typeof envelope.data !== "object" ||
      envelope.data === null
    ) {
      return [];
    }
    const content = String((envelope.data as { content?: unknown }).content ?? "");
    if (!content.startsWith("/")) return [];
    const parts = content.trim().slice(1).split(/\s+/);
    return parts.slice(1);
  }
}
