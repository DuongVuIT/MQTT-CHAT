import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";
import { useChatStore } from "@/store/chat-store";

/** Apply a canonical read receipt to the Web projection. Self-user events are
 * intentional: another tab/device must converge on the durable watermark. */
export function applyCanonicalReadReceipt(envelope: EventEnvelope): void {
  const data = envelope.data as Record<string, unknown>;
  const conversationId = envelope.conversationId ?? String(data["conversationId"] ?? "");
  const userId = String(data["userId"] ?? "");
  const sequence = Number(data["lastReadSequence"]);
  if (!conversationId || !userId || !Number.isFinite(sequence)) return;
  useChatStore.getState().applyReadReceipt(conversationId, userId, sequence);
}
