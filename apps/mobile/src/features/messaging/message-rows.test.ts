import {
  buildChatRows,
  dateLabel,
  formatSize,
  mediaInfo,
  type ChatRow,
} from "@app/features/messaging/message-rows";
import type { ApiMessage } from "@app/lib/api";

function msg(partial: Partial<ApiMessage>): ApiMessage {
  return {
    id: partial.id ?? "m",
    clientMessageId: "cmid",
    conversationId: "c1",
    senderId: "a",
    senderType: "USER",
    senderName: "Alice",
    sequence: 1,
    type: "TEXT",
    content: "hello",
    replyToId: null,
    metadata: null,
    reactions: [],
    createdAt: "2026-08-24T10:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    ...partial,
  };
}

const OPTS = { identityUserId: "me", isGroup: false, readWatermark: 0 };

/** ISO string N days before "now" (local-clock safe, same time of day). */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function messageRows(rows: ChatRow[]): Map<string, Extract<ChatRow, { kind: "message" }>> {
  return new Map(rows.filter((r) => r.kind === "message").map((r) => [r.key, r]));
}

describe("buildChatRows", () => {
  it("returns rows newest-first (inverted-list contract)", () => {
    const rows = buildChatRows(
      [
        msg({ id: "m1", sequence: 1 }),
        msg({ id: "m2", sequence: 2, createdAt: "2026-08-24T10:01:00.000Z" }),
      ],
      [],
      OPTS,
    );
    // A day-break separator may precede the oldest message; message order
    // itself must be strictly newest-first.
    const ids = rows.filter((r) => r.kind === "message").map((r) => r.message.id);
    expect(ids).toEqual(["m2", "m1"]);
  });

  it("groups consecutive same-sender messages and marks run boundaries", () => {
    const rows = buildChatRows(
      [
        msg({ id: "m1", senderId: "a", sequence: 1 }),
        msg({
          id: "m2",
          senderId: "a",
          sequence: 2,
          createdAt: "2026-08-24T10:01:00.000Z",
        }),
        msg({
          id: "m3",
          senderId: "b",
          sequence: 3,
          createdAt: "2026-08-24T10:02:00.000Z",
        }),
      ],
      [],
      OPTS,
    );
    const byId = messageRows(rows);
    // Desc order: m3 (b) → m2 → m1. m1 OPENS a's run (nothing older);
    // m2 continues it; m2 ENDS it because b speaks after.
    expect(byId.get("m1")?.startsGroup).toBe(true);
    expect(byId.get("m1")?.endsGroup).toBe(false);
    expect(byId.get("m2")?.startsGroup).toBe(false);
    expect(byId.get("m2")?.endsGroup).toBe(true);
    expect(byId.get("m3")?.startsGroup).toBe(true);
    expect(byId.get("m3")?.endsGroup).toBe(true);
  });

  it("breaks a sender run across a >5min time gap", () => {
    const rows = buildChatRows(
      [
        msg({ id: "m1", senderId: "a", sequence: 1 }),
        msg({
          id: "m2",
          senderId: "a",
          sequence: 2,
          createdAt: "2026-08-24T10:20:00.000Z",
        }),
      ],
      [],
      OPTS,
    );
    const byId = messageRows(rows);
    // 20 minutes apart ⇒ two separate runs, each with its own start/end.
    expect(byId.get("m2")?.startsGroup).toBe(true);
    expect(byId.get("m2")?.endsGroup).toBe(true);
    expect(byId.get("m1")?.startsGroup).toBe(true);
    expect(byId.get("m1")?.endsGroup).toBe(true);
  });

  it("inserts exactly one date separator per day change, newest first", () => {
    const rows = buildChatRows(
      [
        msg({ id: "old", sequence: 1, createdAt: daysAgoIso(3) }),
        msg({ id: "mid", sequence: 2, createdAt: daysAgoIso(1) }),
        msg({ id: "new", sequence: 3, createdAt: daysAgoIso(0) }),
      ],
      [],
      OPTS,
    );
    const dates = rows.filter((r) => r.kind === "date");
    expect(dates).toHaveLength(3);
    expect(dates.map((d) => (d.kind === "date" ? d.label : ""))).toEqual([
      "Today",
      "Yesterday",
      expect.any(String),
    ]);
  });

  it("aggregates reactions by emoji with mine flag and stable order", () => {
    const rows = buildChatRows(
      [
        msg({
          id: "m1",
          sequence: 1,
          reactions: [
            { emoji: "👍", userId: "me" },
            { emoji: "👍", userId: "a" },
            { emoji: "❤️", userId: "b" },
          ],
        }),
      ],
      [],
      OPTS,
    );
    const row = rows.find((r) => r.kind === "message") as Extract<ChatRow, { kind: "message" }>;
    expect(row.chips).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "❤️", count: 1, mine: false },
    ]);
  });

  it("resolves reply sources and flags read state past the watermark", () => {
    const rows = buildChatRows(
      [
        msg({ id: "m1", sequence: 1 }),
        msg({
          id: "m2",
          sequence: 2,
          replyToId: "m1",
          createdAt: "2026-08-24T10:01:00.000Z",
        }),
      ],
      [],
      { ...OPTS, readWatermark: 2 },
    );
    const byId = messageRows(rows);
    expect(byId.get("m2")?.replySource?.id).toBe("m1");
    expect(byId.get("m2")?.read).toBe(true);
    expect(byId.get("m1")?.read).toBe(true);
  });

  it("renders pending entries newest-first with media shape preserved", () => {
    const rows = buildChatRows(
      [msg({ id: "m1", sequence: 1 })],
      [
        {
          clientMessageId: "p1",
          conversationId: "c1",
          content: "📎 photo.jpg",
          replyToId: null,
          status: "pending",
          type: "IMAGE",
          metadata: { filename: "photo.jpg" },
        },
      ],
      OPTS,
    );
    expect(rows[0]?.kind).toBe("pending");
    const p = rows[0] as Extract<ChatRow, { kind: "pending" }>;
    expect(p.media).toEqual({ type: "IMAGE", filename: "photo.jpg" });
  });

  it("shows sender names in groups only for run starts of others", () => {
    const rows = buildChatRows(
      [
        msg({ id: "m1", senderId: "a", senderName: "Alice", sequence: 1 }),
        msg({
          id: "m2",
          senderId: "a",
          senderName: "Alice",
          sequence: 2,
          createdAt: "2026-08-24T10:01:00.000Z",
        }),
      ],
      [],
      { ...OPTS, isGroup: true },
    );
    const byId = messageRows(rows);
    expect(byId.get("m1")?.showSender).toBe(true);
    expect(byId.get("m2")?.showSender).toBe(false);
  });
});

describe("helpers", () => {
  it("dateLabel buckets days", () => {
    const now = new Date();
    const local = (dayOffset: number): string => {
      const d = new Date(now);
      d.setDate(d.getDate() - dayOffset);
      return d.toISOString();
    };
    expect(dateLabel(local(0), now)).toBe("Today");
    expect(dateLabel(local(1), now)).toBe("Yesterday");
    expect(dateLabel(local(3), now)).toBeTruthy();
  });

  it("formatSize stays human", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5 * 1_048_576)).toBe("5.0 MB");
  });

  it("mediaInfo requires a durable storageKey", () => {
    expect(mediaInfo(msg({ metadata: null }))).toBeNull();
    expect(
      mediaInfo(
        msg({
          metadata: {
            storageKey: "k",
            filename: "f.png",
            size: 10,
            mimeType: "image/png",
          },
        }),
      ),
    ).toEqual({
      storageKey: "k",
      filename: "f.png",
      mimeType: "image/png",
      size: 10,
    });
  });
});
