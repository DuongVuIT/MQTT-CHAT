/**
 * Canonical read-watermark advance — shared by web store and mobile reducer.
 *
 * REGRESSION ROOT CAUSE (2026-08-25): clients kept per-member
 * `lastReadSequence` inside their conversation state, but (a) never advanced
 * their OWN watermark after publishing `receipt.read` (the badge only healed
 * on the next refetch) and (b) applied incoming receipts with a blind SET, so
 * a QoS1 redelivery or out-of-order event could move the watermark BACKWARDS.
 *
 * The watermark is a monotonic high-water mark (AGENTS: receipts.ts treats it
 * exactly that way server-side). Every client must merge through this helper:
 * returns a NEW array when anything advanced, null when nothing changed.
 */

export interface WatermarkMember {
  userId: string;
  lastReadSequence: number;
}

/**
 * Advance ONE member's read watermark to `lastReadSequence` (monotonic max).
 * Returns null when the member is absent, the sequence is not newer, or the
 * array is unchanged — callers treat null as "no state update".
 */
export function advanceMemberWatermark<T extends WatermarkMember>(
  members: readonly T[] | undefined,
  userId: string,
  lastReadSequence: number,
): T[] | null {
  if (!members || !Number.isFinite(lastReadSequence)) return null;
  let changed = false;
  const next = members.map((m): T => {
    if (m.userId !== userId) return m;
    if (lastReadSequence <= m.lastReadSequence) return m; // stale/duplicate
    changed = true;
    return { ...m, lastReadSequence };
  });
  return changed ? next : null;
}
