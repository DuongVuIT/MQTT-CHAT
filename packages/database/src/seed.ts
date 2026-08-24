/**
 * Seed data: demo users, conversations, system-bot + demo rules.
 * Run: pnpm db:seed (requires PostgreSQL running via docker compose).
 */
import { PrismaClient } from "@prisma/client";
import { directPairKeyFor } from "./index";

const prisma = new PrismaClient();

const USERS = [
  { id: "duong", displayName: "Dương", avatarUrl: null },
  { id: "alice", displayName: "Alice", avatarUrl: null },
  { id: "bob", displayName: "Bob", avatarUrl: null },
  { id: "john", displayName: "John", avatarUrl: null },
  // Bot identity row — required by the Message.sender FK; senderType marks it as BOT.
  { id: "system-bot", displayName: "System Bot", avatarUrl: null },
];

const WELCOME_RULE = {
  trigger: { event: "message.created" },
  conditions: [
    { field: "data.content", operator: "matches_regex", value: "(xin chào|hello bot|hi bot)" },
  ],
  actions: [{ type: "reply", content: "Chào bạn 👋 Mình có thể giúp gì? Thử /help nhé!" }],
};

const PING_RULE = {
  trigger: { command: "ping" },
  conditions: [],
  actions: [{ type: "reply", content: "pong 🏓" }],
};

const HELP_RULE = {
  trigger: { command: "help" },
  conditions: [],
  actions: [
    {
      type: "reply",
      content: [
        "Các lệnh khả dụng:",
        "/ping – kiểm tra bot còn sống",
        "/status <user> – trạng thái một user",
        "/users – danh sách user",
        "/stats – thống kê hệ thống",
        "/room – thông tin phòng hiện tại",
        "Nói 'xin chào' để được chào lại, nói 'nice' để xem bot react 😄",
      ].join("\n"),
    },
  ],
};

const STATUS_RULE = {
  trigger: { command: "status" },
  conditions: [],
  actions: [{ type: "reply_status", userArgIndex: 0 }],
};

const USERS_RULE = {
  trigger: { command: "users" },
  conditions: [],
  actions: [{ type: "reply_users" }],
};

const STATS_RULE = {
  trigger: { command: "stats" },
  conditions: [],
  actions: [{ type: "reply_stats" }],
};

const ROOM_RULE = {
  trigger: { command: "room" },
  conditions: [],
  actions: [{ type: "reply_room" }],
};

const NICE_REACTION_RULE = {
  trigger: { event: "message.created" },
  conditions: [{ field: "data.content", operator: "contains", value: "nice" }],
  actions: [{ type: "add_reaction", emoji: "👍" }],
};

const DELAYED_RULE = {
  trigger: { event: "message.created" },
  conditions: [{ field: "data.content", operator: "equals", value: "bot ơi" }],
  actions: [
    { type: "delay", ms: 1500 },
    { type: "reply", content: "Dạ, em nghe đây! (trả lời sau 1.5s)" },
  ],
};

/** Two-step session-state flow proving bot state works. */
const INTRO_START_RULE = {
  trigger: { event: "message.created" },
  conditions: [{ field: "data.content", operator: "equals", value: "/intro" }],
  actions: [
    { type: "set_state", key: "flow", value: "WAITING_FOR_NAME" },
    { type: "reply", content: "Tên bạn là gì?" },
  ],
};

const INTRO_CAPTURE_RULE = {
  trigger: { event: "message.created" },
  conditions: [{ field: "state.flow", operator: "equals", value: "WAITING_FOR_NAME" }],
  actions: [
    { type: "reply", content: "Rất vui được gặp bạn, {{sender}}! 🎉" },
    { type: "delete_state", key: "flow" },
  ],
};

async function main(): Promise<void> {
  console.log("Seeding database...");

  for (const user of USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { displayName: user.displayName },
      create: user,
    });
  }

  const general = await prisma.conversation.upsert({
    where: { id: "conv-general" },
    update: {},
    create: {
      id: "conv-general",
      type: "GROUP",
      title: "General",
      createdBy: "duong",
    },
  });

  await prisma.conversation.upsert({
    where: { id: "conv-random" },
    update: {},
    create: { id: "conv-random", type: "GROUP", title: "Random", createdBy: "alice" },
  });

  // Direct conversations (duong<->alice, bob<->john).
  await ensureDirect("conv-direct-duong-alice", "duong", "alice");
  await ensureDirect("conv-direct-bob-john", "bob", "john");

  // Invariant guard: DIRECT conversations hold EXACTLY their pair (the API
  // enforces this on create). Prune any stray membership legacy runs left
  // behind (e.g. a bot joined to a demo pair breaks peer-relative labels).
  for (const [id, userA, userB] of [
    ["conv-direct-duong-alice", "duong", "alice"],
    ["conv-direct-bob-john", "bob", "john"],
  ] as const) {
    await prisma.conversationMember.deleteMany({
      where: { conversationId: id, userId: { notIn: [userA, userB] } },
    });
  }

  for (const userId of ["duong", "alice", "bob", "john"]) {
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: general.id, userId } },
      update: {},
      create: { conversationId: general.id, userId, role: userId === "duong" ? "ADMIN" : "MEMBER" },
    });
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: "conv-random", userId } },
      update: {},
      // conv-random's creator is its ADMIN — the API refuses groups whose
      // creator is not a member (zero-ADMIN groups are unmanageable).
      create: {
        conversationId: "conv-random",
        userId,
        role: userId === "alice" ? "ADMIN" : "MEMBER",
      },
    });
  }

  // System bot + demo rules.
  // Bot.id intentionally equals the bot's User identity id ("system-bot") so
  // ConversationMember/Message FKs resolve to the same identity row.
  const bot = await prisma.bot.upsert({
    where: { name: "system-bot" },
    update: {},
    create: {
      id: "system-bot",
      name: "system-bot",
      enabled: true,
      settings: { commandPrefix: "/", allowBotMessages: false, maxAutomationDepth: 3 },
    },
  });

  // The bot must be a conversation member to send messages through chat-worker.
  for (const groupId of [general.id, "conv-random"]) {
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: groupId, userId: bot.id } },
      update: {},
      create: { conversationId: groupId, userId: bot.id, role: "MEMBER" },
    });
  }

  const rules = [
    {
      name: "welcome-greeting",
      description: 'Reply khi user nói "xin chào"',
      priority: 10,
      rule: WELCOME_RULE,
    },
    { name: "cmd-ping", description: "/ping → pong", priority: 1, rule: PING_RULE },
    { name: "cmd-help", description: "/help → danh sách lệnh", priority: 1, rule: HELP_RULE },
    {
      name: "cmd-status",
      description: "/status <user> → trạng thái user",
      priority: 1,
      rule: STATUS_RULE,
    },
    { name: "cmd-users", description: "/users → danh sách user", priority: 1, rule: USERS_RULE },
    { name: "cmd-stats", description: "/stats → thống kê", priority: 1, rule: STATS_RULE },
    { name: "cmd-room", description: "/room → thông tin phòng", priority: 1, rule: ROOM_RULE },
    {
      name: "reaction-nice",
      description: 'React 👍 khi message chứa "nice"',
      priority: 20,
      rule: NICE_REACTION_RULE,
    },
    {
      name: "delayed-response",
      description: "Demo delayed response",
      priority: 30,
      rule: DELAYED_RULE,
    },
    {
      name: "intro-start",
      description: "Bắt đầu flow hỏi tên (state)",
      priority: 5,
      rule: INTRO_START_RULE,
    },
    {
      name: "intro-capture",
      description: "Bắt tên từ session state",
      priority: 4,
      rule: INTRO_CAPTURE_RULE,
    },
  ];

  for (const r of rules) {
    const existing = await prisma.botRule.findFirst({
      where: { botId: bot.id, name: r.name },
    });
    if (existing) {
      await prisma.botRule.update({
        where: { id: existing.id },
        data: {
          description: r.description,
          trigger: r.rule.trigger,
          conditions: r.rule.conditions,
          actions: r.rule.actions,
          priority: r.priority,
        },
      });
    } else {
      await prisma.botRule.create({
        data: {
          botId: bot.id,
          name: r.name,
          description: r.description,
          trigger: r.rule.trigger,
          conditions: r.rule.conditions,
          actions: r.rule.actions,
          priority: r.priority,
        },
      });
    }
  }

  console.log("Seed completed.");
}

async function ensureDirect(id: string, userA: string, userB: string): Promise<void> {
  // Canonical pair key MUST be set at creation (duplicate-Alice root cause):
  // a NULL key makes the row invisible to the API's reuse fast-path
  // (NULL never matches a unique lookup), so tapping the same peer again in
  // a picker minted a SECOND direct conversation for the same pair.
  const directPairKey = directPairKeyFor(userA, userB);
  await prisma.conversation.upsert({
    where: { id },
    update: {},
    create: { id, type: "DIRECT", title: null, createdBy: userA, directPairKey },
  });
  // Heal legacy rows seeded before the contract existed — but only when no
  // other row already owns the key (the UNIQUE index forbids twins).
  const keyOwner = await prisma.conversation.findUnique({ where: { directPairKey } });
  if (!keyOwner) {
    await prisma.conversation.updateMany({
      where: { id, type: "DIRECT", directPairKey: null },
      data: { directPairKey },
    });
  }
  for (const userId of [userA, userB]) {
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: id, userId } },
      update: {},
      create: { conversationId: id, userId },
    });
  }
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
