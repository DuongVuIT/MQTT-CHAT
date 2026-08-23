import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  buildEventEnvelope,
  conversationCreatedDataSchema,
  EVENT_TOPICS,
  type ConversationCreatedData,
} from "@mqtt-chat/mqtt-contracts";
import { directPairKeyFor, Prisma, toPrismaJson } from "@mqtt-chat/database";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { ZodValidationPipe, apiError } from "../common";

/**
 * Users / Conversations / Members / History endpoints.
 * Realtime is NOT handled here — MQTT owns that; HTTP is for history + setup.
 */

const createUserSchema = z.object({
  id: z.string().min(1).max(64),
  displayName: z.string().min(1).max(100),
  avatarUrl: z.string().url().nullable().optional(),
});

const createConversationSchema = z.object({
  type: z.enum(["DIRECT", "GROUP"]),
  title: z.string().min(1).max(100).nullable().optional(),
  createdBy: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(2).max(50),
});

const addMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

@Controller()
export class ChatController {
  // Explicit token: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // ---------- Presence snapshot ----------

  /**
   * Server-authoritative presence snapshot read from Redis (written by
   * chat-worker). Users not present in the response are UNKNOWN to the
   * client — the client must NOT render them as offline.
   */
  @Get("presence")
  async getPresence(@Query("userIds") userIds: string) {
    const ids = (userIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id.length <= 64)
      .slice(0, 100);
    if (ids.length === 0) {
      throw new NotFoundException(apiError("BAD_REQUEST", "userIds query param required"));
    }
    const entries = await Promise.all(
      ids.map(async (userId) => {
        const info = await this.redis.presence.getPresence(userId);
        return [
          userId,
          { online: info.online, connectionCount: info.connectionCount, devices: info.devices },
        ] as const;
      }),
    );
    return { presence: Object.fromEntries(entries) };
  }

  // ---------- Users ----------

  @Get("users")
  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, avatarUrl: true, createdAt: true },
    });
    return { users };
  }

  @Post("users")
  async createUser(@Body(new ZodValidationPipe(createUserSchema)) body: unknown) {
    const data = body as z.infer<typeof createUserSchema>;
    const user = await this.prisma.user.upsert({
      where: { id: data.id },
      update: { displayName: data.displayName },
      create: {
        id: data.id,
        displayName: data.displayName,
        ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
      },
    });
    return { user };
  }

  // ---------- Conversations ----------

  @Get("conversations")
  async listConversations(@Query("userId") userId?: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: userId ? { members: { some: { userId } } } : undefined,
      include: {
        members: { select: { userId: true, role: true, lastReadSequence: true } },
        messages: {
          orderBy: { sequence: "desc" },
          take: 1,
          select: { content: true, type: true, deletedAt: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        memberCount: c.members.length,
        lastSequence: c.lastSequence,
        lastMessagePreview:
          c.messages[0] && !c.messages[0].deletedAt
            ? c.messages[0].type === "TEXT"
              ? c.messages[0].content.slice(0, 120)
              : `[${c.messages[0].type.toLowerCase()}]`
            : null,
        lastMessageAt: c.messages[0]?.createdAt ?? null,
        members: c.members,
      })),
    };
  }

  @Post("conversations")
  async createConversation(@Body(new ZodValidationPipe(createConversationSchema)) body: unknown) {
    const data = body as z.infer<typeof createConversationSchema>;

    // DIRECT conversations are unique per user pair via the canonical
    // `directPairKey` (sorted "a:b", computed SERVER-SIDE — never trusted
    // from the client) and a DB UNIQUE index. The pair key is derived from
    // runtime user ids only; display names are irrelevant to identity.
    let directPairKey: string | null = null;
    if (data.type === "DIRECT") {
      const [a, b] = data.memberIds;
      if (a === undefined || b === undefined || a === b || data.memberIds.length !== 2) {
        throw new NotFoundException(
          apiError("BAD_REQUEST", "DIRECT conversations require exactly two distinct memberIds"),
        );
      }
      directPairKey = directPairKeyFor(a, b);
      // Fast path: reuse by the unique pair key. include members: the
      // reused conversation must satisfy the same response contract as a
      // freshly created one — clients rely on `members` being present.
      const existing = await this.prisma.conversation.findUnique({
        where: { directPairKey },
        include: { members: true },
      });
      if (existing) return { conversation: existing, reused: true };
    }

    // Create the conversation AND its canonical conversation.created outbox
    // event in ONE transaction. The chat-worker outbox relay publishes the
    // event to EMQX, so every member's clients update their conversation
    // list in realtime — no page refresh required.
    // Race safety: two concurrent creates for the same pair can both miss
    // the fast-path check; the DB UNIQUE index on directPairKey is the
    // authority — the loser gets P2002 and reuses the winner's row.
    let conversation;
    try {
      conversation = await this.createWithOutboxEvent(data, directPairKey);
    } catch (err) {
      if (
        directPairKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await this.prisma.conversation.findUnique({
          where: { directPairKey },
          include: { members: true },
        });
        if (existing) return { conversation: existing, reused: true };
      }
      throw err;
    }
    return { conversation, reused: false };
  }

  private async createWithOutboxEvent(
    data: z.infer<typeof createConversationSchema>,
    directPairKey: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          type: data.type,
          ...(directPairKey ? { directPairKey } : {}),
          title: data.title ?? null,
          createdBy: data.createdBy,
          members: {
            create: data.memberIds.map((userId) => ({
              userId,
              role: userId === data.createdBy && data.type === "GROUP" ? "ADMIN" : "MEMBER",
            })),
          },
        },
        include: { members: true },
      });

      const memberSummaries = created.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        lastReadSequence: m.lastReadSequence,
      }));
      const eventData: ConversationCreatedData = conversationCreatedDataSchema.parse({
        id: created.id,
        type: created.type,
        title: created.title,
        memberCount: memberSummaries.length,
        lastSequence: created.lastSequence,
        lastMessagePreview: null,
        lastMessageAt: null,
        members: memberSummaries,
        createdAt: created.createdAt.toISOString(),
      });
      const event = buildEventEnvelope<ConversationCreatedData>({
        eventType: "conversation.created",
        origin: { type: "user", id: data.createdBy },
        actor: { userId: data.createdBy },
        conversationId: created.id,
        data: eventData,
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "conversation.created",
          aggregateType: "Conversation",
          aggregateId: created.id,
          topic: EVENT_TOPICS.conversationCreated,
          payload: toPrismaJson(event),
        },
      });

      return created;
    });
  }

  @Get("conversations/:id")
  async getConversation(@Param("id") id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException(apiError("CONVERSATION_NOT_FOUND", "Conversation not found"));
    }
    return { conversation };
  }

  @Post("conversations/:id/members")
  async addMembers(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addMembersSchema)) body: unknown,
  ) {
    const data = body as z.infer<typeof addMembersSchema>;
    const conversation = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      throw new NotFoundException(apiError("CONVERSATION_NOT_FOUND", "Conversation not found"));
    }
    await this.prisma.conversationMember.createMany({
      data: data.userIds.map((userId) => ({ conversationId: id, userId })),
      skipDuplicates: true,
    });
    return { added: data.userIds.length };
  }

  @Delete("conversations/:id/members/:userId")
  async removeMember(@Param("id") id: string, @Param("userId") userId: string) {
    await this.prisma.conversationMember.deleteMany({
      where: { conversationId: id, userId },
    });
    return { removed: true };
  }

  // ---------- Message history (cursor pagination) ----------

  @Get("conversations/:id/messages")
  async listMessages(
    @Param("id") id: string,
    @Query("before") before?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = Math.min(Math.max(Number.parseInt(limit ?? "50", 10) || 50, 1), 100);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        ...(before ? { sequence: { lt: Number.parseInt(before, 10) || 0 } } : {}),
        ...(after ? { sequence: { gt: Number.parseInt(after, 10) || 0 } } : {}),
      },
      orderBy: { sequence: after ? "asc" : "desc" },
      take: parsedLimit,
      include: {
        reactions: { select: { emoji: true, userId: true } },
        sender: { select: { displayName: true } },
      },
    });

    const ordered = after ? messages : [...messages].reverse();

    return {
      messages: ordered.map((m) => ({
        id: m.id,
        clientMessageId: m.clientMessageId,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderType: m.senderType,
        senderName: m.sender.displayName,
        sequence: m.sequence,
        type: m.type,
        content: m.content,
        replyToId: m.replyToId,
        metadata: m.metadata,
        reactions: m.reactions,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        deletedAt: m.deletedAt?.toISOString() ?? null,
      })),
      hasMore: messages.length === parsedLimit,
    };
  }

  @Get("messages/:id")
  async getMessage(@Param("id") id: string) {
    const message = await this.prisma.message.findUnique({
      where: { id },
      include: { reactions: true },
    });
    if (!message) throw new NotFoundException(apiError("MESSAGE_NOT_FOUND", "Message not found"));
    return { message };
  }
}
