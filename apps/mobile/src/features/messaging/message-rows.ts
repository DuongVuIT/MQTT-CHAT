/**
 * Pure chat-transcript row model (phase-2 §11/§12/§13): turns ascending
 * messages into DESCENDING render rows (for an inverted FlatList) with
 * sender-run grouping, time-gap breaks, date separators, aggregated reaction
 * chips, resolved reply sources and read-state projection.
 *
 * Pure TypeScript — no React/RN imports — so the grouping rules are unit-
 * testable (message-rows.test.ts) and the screen stays presentational.
 */

import type { ApiMessage } from '../../lib/api';
import type { PendingMessage } from './message-lifecycle';

export interface ReactionChip {
  emoji: string;
  count: number;
  mine: boolean;
}

export type ChatRow =
  | {
      kind: 'date';
      key: string;
      label: string;
    }
  | {
      kind: 'message';
      key: string;
      message: ApiMessage;
      mine: boolean;
      /** First bubble of a sender run (top corners stay round). */
      startsGroup: boolean;
      /** Last bubble of a run — tail corner tightens toward the sender. */
      endsGroup: boolean;
      /** Group chats: show the sender name above a run's first bubble. */
      showSender: boolean;
      replySource: ApiMessage | null;
      chips: ReactionChip[];
      /** Peer read watermark reached this message's sequence. */
      read: boolean;
    }
  | {
      kind: 'pending';
      key: string;
      pending: PendingMessage;
      /** Media pending renders as its card shape, not plain text (§20). */
      media:
        | { type: 'IMAGE'; filename: string }
        | { type: 'FILE'; filename: string }
        | null;
    };

/** Messages ≥ this far apart never group into one sender run (§12). */
const GROUP_GAP_MS = 5 * 60 * 1000;

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export interface MediaInfo {
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Resolve durable media metadata from message metadata (storageKey only). */
export function mediaInfo(message: ApiMessage): MediaInfo | null {
  const meta = message.metadata as Record<string, unknown> | null;
  if (!meta) return null;
  const key = meta['storageKey'];
  if (typeof key !== 'string' || key.length === 0) return null;
  return {
    storageKey: key,
    filename:
      typeof meta['filename'] === 'string' ? meta['filename'] : 'attachment',
    mimeType:
      typeof meta['mimeType'] === 'string'
        ? meta['mimeType']
        : 'application/octet-stream',
    size: typeof meta['size'] === 'number' ? meta['size'] : 0,
  };
}

/** §13 — subtle day labels; only rendered when the day actually changes. */
export function dateLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7)
    return d.toLocaleDateString([], { weekday: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function aggregateChips(
  reactions: { emoji: string; userId: string }[],
  identityUserId: string | null,
): ReactionChip[] {
  const map = new Map<string, ReactionChip>();
  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (identityUserId !== null && r.userId === identityUserId)
      entry.mine = true;
    map.set(r.emoji, entry);
  }
  // Stable order: most reactions first, then emoji — deterministic rows.
  return [...map.values()].sort(
    (a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1),
  );
}

export interface BuildChatRowsOptions {
  identityUserId: string | null;
  isGroup: boolean;
  /** Max lastReadSequence among OTHER members — read ticks (§14). */
  readWatermark: number;
}

/**
 * @param messages ASCENDING (oldest→newest) canonical messages
 * @param pending  optimistic entries (rendered newest-first at the bottom)
 * @returns DESCENDING rows (newest first) — feed straight into an inverted
 * FlatList so offset 0 IS the latest message (open-at-latest is free).
 */
export function buildChatRows(
  messages: ApiMessage[],
  pending: PendingMessage[],
  opts: BuildChatRowsOptions,
): ChatRow[] {
  const { identityUserId, isGroup, readWatermark } = opts;
  const byId = new Map(messages.map(m => [m.id, m]));
  const rows: ChatRow[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const prev = i > 0 ? messages[i - 1] : null; // previous in TIME
    const mine = m.senderId === identityUserId && m.senderType === 'USER';

    // Sender-run grouping: same sender AND within the time gap. A deleted
    // message still groups (its tombstone is a bubble).
    const groupsWithPrev =
      prev !== null &&
      prev.senderId === m.senderId &&
      prev.senderType === m.senderType &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <
        GROUP_GAP_MS;

    // Date separator when the day changes vs the previous message in time.
    if (
      prev === null ||
      !sameDay(new Date(m.createdAt), new Date(prev.createdAt))
    ) {
      const label = dateLabel(m.createdAt);
      if (label)
        rows.push({
          kind: 'date',
          key: `date-${m.createdAt.slice(0, 10)}-${m.id}`,
          label,
        });
    }

    const replySource = m.replyToId ? (byId.get(m.replyToId) ?? null) : null;

    rows.push({
      kind: 'message',
      key: m.id,
      message: m,
      mine,
      startsGroup: !groupsWithPrev,
      endsGroup: true, // fixed up in the second pass below
      showSender: isGroup && !mine && !groupsWithPrev,
      replySource,
      chips: aggregateChips(m.reactions ?? [], identityUserId),
      read: m.sequence > 0 && m.sequence <= readWatermark,
    });
  }

  // Second pass: a message ENDS its run when the NEXT-in-time message (the
  // entry BEFORE it in this desc array, skipping date separators) starts a
  // new run. Drives the tightened tail corner. A day break always ends a run.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind !== 'message') continue;
    let next: ChatRow | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (rows[j].kind === 'date') continue;
      next = rows[j];
      break;
    }
    const continues =
      next !== undefined && next.kind === 'message' && !next.startsGroup;
    row.endsGroup = !continues;
  }

  // Optimistic pending entries — newest-first, at the START of the desc
  // array (visual bottom of the inverted list).
  const pendingRows: ChatRow[] = pending.map(p => {
    const meta = p.metadata as Record<string, unknown> | null;
    const filename =
      meta && typeof meta['filename'] === 'string' ? meta['filename'] : null;
    return {
      kind: 'pending' as const,
      key: p.clientMessageId,
      pending: p,
      media:
        p.type === 'IMAGE' && filename
          ? ({ type: 'IMAGE', filename } as const)
          : p.type === 'FILE' && filename
            ? ({ type: 'FILE', filename } as const)
            : null,
    };
  });

  return [...pendingRows.reverse(), ...rows];
}
