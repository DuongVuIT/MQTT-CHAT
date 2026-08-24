#!/usr/bin/env node
/**
 * One-time SAFE cleanup of automated-test residue in the DEVELOPMENT database.
 * (PROJECT_STATUS §33: only remove records proven test-owned.)
 *
 * Deletes EXACTLY:
 *  1. users whose id was minted by this repo's E2E tools:
 *       - `fx…`        (scripts/lib/chat-fixture.mjs run ids)
 *       - `e2e-ua-*` / `e2e-ub-*` (legacy duplicate-direct-e2e identities)
 *  2. conversations whose title matches the suites' generated titles
 *     (`e2e-group-<ts>`, `member-e2e*`), cascading their members/messages.
 *  3. leftover script-authored messages in shared demo conversations,
 *     matched by the exact payload strings those scripts send.
 *
 * It NEVER touches seeded/demo rows (duong/alice/bob/john/system-bot,
 * General/Random rooms, or any message not matching the exact markers).
 *
 * Usage: node scripts/cleanup-dev-data.mjs [--apply]   (default: dry-run)
 */
import { createRequire } from "node:module";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required (load .env first)");
  process.exit(1);
}

const require = createRequire(new URL("../packages/database/src/index.ts", import.meta.url));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const APPLY = process.argv.includes("--apply");
// Exact strings authored by repo test scripts — never user-typed demo text.
const SCRIPT_MESSAGE_MARKERS = [
  "hello from smoke",
  "/ping",
  "pong 🏓",
  "/help",
  "/stats",
  "/users",
];

/** Conversation-title prefixes minted by this repo's E2E tooling. */
const TEST_TITLE_PREFIXES = ["e2e-group-", "member-e2e", "web-e2e-", "discovery-", "repro-group-"];

const report = {};

async function main() {
  // 1+2. Test-owned conversations by generated titles.
  const testConversations = await prisma.conversation.findMany({
    where: {
      OR: [
        ...TEST_TITLE_PREFIXES.map((prefix) => ({ title: { startsWith: prefix } })),
        { type: "DIRECT", createdBy: { startsWith: "fx" } },
        { type: "DIRECT", createdBy: { startsWith: "e2e-u" } },
        { createdBy: { startsWith: "u-repro-" } },
        { createdBy: { startsWith: "u-wm-" } },
      ],
    },
    select: { id: true, title: true },
  });

  // 1. Test-owned users by tooling id prefixes.
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { startsWith: "fx" } },
        { id: { startsWith: "e2e-ua-" } },
        { id: { startsWith: "e2e-ub-" } },
        // discovery/repro E2E identities (`u-wm-<run>-web|mob`, `u-repro-*`):
        // same minters the conversation query matches by createdBy.
        { id: { startsWith: "u-wm-" } },
        { id: { startsWith: "u-repro-" } },
      ],
    },
    select: { id: true },
  });

  // 3. Script-authored messages in surviving conversations.
  const scriptMessages = await prisma.message.findMany({
    where: {
      conversationId: { notIn: testConversations.map((c) => c.id) },
      OR: [
        ...SCRIPT_MESSAGE_MARKERS.map((content) => ({ content })),
        { content: { startsWith: "gateway round-trip" } },
        { content: { startsWith: "admin live feed probe" } },
        { content: { startsWith: "admin probe" } },
        { content: { startsWith: "CONTRACT-EVENT-PROBE" } },
        { content: { startsWith: "LIVEPROBE" } },
        { content: { startsWith: "immediate-send-" } },
        { clientMessageId: { startsWith: "gwtest-" } },
        { clientMessageId: { startsWith: "smoke-" } },
        { clientMessageId: { startsWith: "bot-e2e-" } },
        { clientMessageId: { startsWith: "adm-" } },
        { clientMessageId: { startsWith: "admprb-" } },
        { clientMessageId: { startsWith: "contract-" } },
        // Ad-hoc (uncommitted) debug-script residue observed in the dev DB:
        // reply-feature reproduction rows ("REPLY-BASE" content).
        { content: { startsWith: "REPLY-BASE" } },
        { clientMessageId: { startsWith: "reply-base-" } },
        // notification-e2e.mjs mints `notify-e2e-<uuid8>` into a SHARED demo
        // conversation on every run and never deletes it.
        { content: { startsWith: "notify-e2e-" } },
      ],
    },
    select: { id: true, content: true, conversationId: true },
  });

  report.testConversations = testConversations.length;
  report.testUsers = testUsers.length;
  report.scriptMessages = scriptMessages.length;

  // 5. Tombstoned TOOLING-owned groups (#28): soft-deleted via the product
  // endpoint are invisible to users but still physically present. User-deleted
  // demo groups are NEVER touched — only tooling-minted titles/creators.
  const tombstonedTestGroups = await prisma.conversation.findMany({
    where: {
      deletedAt: { not: null },
      OR: [
        ...TEST_TITLE_PREFIXES.map((prefix) => ({ title: { startsWith: prefix } })),
        { createdBy: { startsWith: "u-repro-" } },
        { createdBy: { startsWith: "u-wm-" } },
      ],
    },
    select: { id: true, title: true },
  });
  report.tombstonedTestGroups = tombstonedTestGroups.length;

  console.log("DRY-RUN plan:", report);
  if (!APPLY) {
    console.log("(re-run with --apply to delete exactly these rows)");
    return;
  }

  // One batched delete over the DEDUPED id set (a row can match both lists).
  const testConversationIds = [
    ...new Set([...testConversations, ...tombstonedTestGroups].map((c) => c.id)),
  ];
  await prisma.conversation.deleteMany({
    where: { id: { in: testConversationIds } },
  });
  // Script messages BEFORE users: Message.sender is restrict-on-delete, so a
  // matched residue row authored by a matched test user would otherwise make
  // that user's delete fail (silently skipped below).
  await prisma.message.deleteMany({
    where: { id: { in: scriptMessages.map((m) => m.id) } },
  });
  for (const u of testUsers) {
    try {
      await prisma.user.delete({ where: { id: u.id } });
    } catch (err) {
      console.warn(`user ${u.id} still referenced (${err.code ?? err.message}); skipped`);
    }
  }

  // 4. Repair the DIRECT-conversation invariant (exactly 2 distinct members):
  //    legacy runs left the bot joined to demo DIRECT pairs, which breaks
  //    peer-relative labels ("DIRECT requires exactly two memberIds").
  const botMemberships = await prisma.conversationMember.findMany({
    where: {
      userId: "system-bot",
      conversation: { type: "DIRECT" },
    },
    select: { conversationId: true },
  });
  await prisma.conversationMember.deleteMany({
    where: { userId: "system-bot", conversation: { type: "DIRECT" } },
  });

  console.log(
    `APPLIED: deleted ${testConversations.length} conversations, ${testUsers.length} users, ${scriptMessages.length} script messages, ${botMemberships.length} stray bot DIRECT memberships.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
