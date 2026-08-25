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

export function dateLabel(timestamp: string, now: Date = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString([], { weekday: "long" });
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(
    [],
    sameYear
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}

function sameDay(firstDate: Date, secondDate: Date): boolean {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
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
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const rows: ChatRow[] = [];

  const chipMap = new Map<string, ReactionChip>();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const previousMessage = i > 0 ? (messages[i - 1] ?? null) : null;
    const mine = message.senderId === identityUserId && message.senderType === "USER";

    const groupsWithPrev =
      previousMessage !== null &&
      previousMessage.senderId === message.senderId &&
      previousMessage.senderType === message.senderType &&
      new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime() <
        GROUP_GAP_MS;

    if (
      previousMessage === null ||
      !sameDay(new Date(message.createdAt), new Date(previousMessage.createdAt))
    ) {
      const label = dateLabel(message.createdAt);
      if (label)
        rows.push({
          kind: "date",
          key: `date-${message.createdAt.slice(0, 10)}-${message.id}`,
          label,
        });
    }

    // Aggregate this message's reactions (insertion-ordered, then counted).
    chipMap.clear();
    for (const reaction of message.reactions ?? []) {
      const entry = chipMap.get(reaction.emoji) ?? {
        emoji: reaction.emoji,
        count: 0,
        mine: false,
      };
      entry.count += 1;
      if (identityUserId !== null && reaction.userId === identityUserId) entry.mine = true;
      chipMap.set(reaction.emoji, entry);
    }

    rows.push({
      kind: "message",
      key: message.id,
      message,
      mine,
      startsGroup: !groupsWithPrev,
      endsGroup: true, // fixed up below
      showSender: isGroup && !mine && !groupsWithPrev,
      replySource: message.replyToId ? (messagesById.get(message.replyToId) ?? null) : null,
      chips: [...chipMap.values()].sort(
        (firstChip, secondChip) =>
          secondChip.count - firstChip.count || (firstChip.emoji < secondChip.emoji ? -1 : 1),
      ),
      read: message.sequence > 0 && message.sequence <= readWatermark,
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
