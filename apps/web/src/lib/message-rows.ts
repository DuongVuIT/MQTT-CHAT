import type { ApiMessage } from "@/lib/api";

/**
 * Web transcript row model — the SAME semantics as the mobile
 * message-rows (§11/§12/§13): sender-run grouping with a 5-minute gap
 * break, one date separator per day change (Today/Yesterday/weekday/date),
 * aggregated reaction chips, and read-state projection against the peers'
 * read watermark. Kept platform-local (no shared DOM/native components, §5)
 * but the RULES are identical so both clients render identically.
 */

export interface ReactionChip {
  emoji: string;
  count: number;
  mine: boolean;
}

export type ChatRow =
  | { kind: "date"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: ApiMessage;
      mine: boolean;
      startsGroup: boolean;
      endsGroup: boolean;
      showSender: boolean;
      replySource: ApiMessage | null;
      chips: ReactionChip[];
      read: boolean;
    };

/** Messages ≥ this far apart never group into one sender run (§12). */
const GROUP_GAP_MS = 5 * 60 * 1000;

export function dateLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOfDay = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface BuildChatRowsOptions {
  identityUserId: string | null;
  isGroup: boolean;
  /** Max lastReadSequence among OTHER members — read ticks (§14). */
  readWatermark: number;
}

/** @param messages ASCENDING (oldest→newest) canonical messages. */
export function buildChatRows(messages: ApiMessage[], opts: BuildChatRowsOptions): ChatRow[] {
  const { identityUserId, isGroup, readWatermark } = opts;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const rows: ChatRow[] = [];

  const chipMap = new Map<string, ReactionChip>();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    const prev = i > 0 ? (messages[i - 1] ?? null) : null; // previous in TIME
    const mine = m.senderId === identityUserId && m.senderType === "USER";

    const groupsWithPrev =
      prev !== null &&
      prev.senderId === m.senderId &&
      prev.senderType === m.senderType &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS;

    if (prev === null || !sameDay(new Date(m.createdAt), new Date(prev.createdAt))) {
      const label = dateLabel(m.createdAt);
      if (label)
        rows.push({
          kind: "date",
          key: `date-${m.createdAt.slice(0, 10)}-${m.id}`,
          label,
        });
    }

    // Aggregate this message's reactions (insertion-ordered, then counted).
    chipMap.clear();
    for (const r of m.reactions ?? []) {
      const entry = chipMap.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      entry.count += 1;
      if (identityUserId !== null && r.userId === identityUserId) entry.mine = true;
      chipMap.set(r.emoji, entry);
    }

    rows.push({
      kind: "message",
      key: m.id,
      message: m,
      mine,
      startsGroup: !groupsWithPrev,
      endsGroup: true, // fixed up below
      showSender: isGroup && !mine && !groupsWithPrev,
      replySource: m.replyToId ? (byId.get(m.replyToId) ?? null) : null,
      chips: [...chipMap.values()].sort(
        (a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1),
      ),
      read: m.sequence > 0 && m.sequence <= readWatermark,
    });
  }

  // A message ENDS its run when the NEXT-in-time message (the entry BEFORE
  // it in this desc array, skipping date separators) starts a new run.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.kind !== "message") continue;
    let next: ChatRow | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      const candidate = rows[j];
      if (!candidate || candidate.kind === "date") continue;
      next = candidate;
      break;
    }
    const continues = next !== undefined && next.kind === "message" && !next.startsGroup;
    row.endsGroup = !continues;
  }

  return rows;
}
