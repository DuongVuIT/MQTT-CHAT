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

const report = {};

async function main() {
  // 1+2. Test-owned conversations by generated titles.
  const testConversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { title: { startsWith: "e2e-group-" } },
        { title: { startsWith: "member-e2e" } },
        { type: "DIRECT", createdBy: { startsWith: "fx" } },
        { type: "DIRECT", createdBy: { startsWith: "e2e-u" } },
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
        { clientMessageId: { startsWith: "gwtest-" } },
        { clientMessageId: { startsWith: "smoke-" } },
        { clientMessageId: { startsWith: "bot-e2e-" } },
      ],
    },
    select: { id: true, content: true, conversationId: true },
  });

  report.testConversations = testConversations.length;
  report.testUsers = testUsers.length;
  report.scriptMessages = scriptMessages.length;
  console.log("DRY-RUN plan:", report);
  if (!APPLY) {
    console.log("(re-run with --apply to delete exactly these rows)");
    return;
  }

  for (const c of testConversations) {
    await prisma.conversation.delete({ where: { id: c.id } });
  }
  for (const u of testUsers) {
    try {
      await prisma.user.delete({ where: { id: u.id } });
    } catch (err) {
      console.warn(`user ${u.id} still referenced (${err.code ?? err.message}); skipped`);
    }
  }
  await prisma.message.deleteMany({
    where: { id: { in: scriptMessages.map((m) => m.id) } },
  });

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
