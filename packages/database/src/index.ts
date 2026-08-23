import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Single Prisma client factory — apps must not create uncontrolled clients.
 */

export * from "@prisma/client";
export { PrismaClient };

/**
 * Convert an arbitrary value into a Prisma JSON column input via JSON
 * round-trip (strips undefined fields that Prisma's InputJsonValue rejects).
 */
export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export interface DbOptions {
  logQueries?: boolean;
}

export function createDb(options: DbOptions = {}): PrismaClient {
  return new PrismaClient({
    log: options.logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/** Singleton for long-running processes (API, workers). */
let globalDb: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (!globalDb) {
    globalDb = createDb();
  }
  return globalDb;
}

export async function closeDb(db: PrismaClient): Promise<void> {
  await db.$disconnect();
}

/**
 * Canonical uniqueness key for DIRECT conversations: the two member ids
 * sorted and joined. Order-independent — ("a","b") and ("b","a") map to the
 * same key, so the DB UNIQUE index on Conversation.directPairKey makes
 * duplicate direct conversations impossible regardless of request races.
 * Server-side only: never trust a client-supplied pair key.
 */
export function directPairKeyFor(userA: string, userB: string): string {
  if (userA === userB) {
    throw new Error("directPairKeyFor: members must be distinct");
  }
  return [userA, userB].sort().join(":");
}
