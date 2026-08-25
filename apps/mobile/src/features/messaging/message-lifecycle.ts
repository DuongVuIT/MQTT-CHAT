/**
 * Platform-agnostic message lifecycle state machine (mirrors the web
 * chat-store semantics): optimistic pending → reconciled by clientMessageId,
 * timeout → failed, retry re-publishes the SAME clientMessageId.
 * Pure TypeScript — unit-testable with jest, no React/RN imports.
 */

import type { ApiMessage } from "@app/lib/api";

export type PendingStatus = "queued" | "pending" | "failed";

export interface PendingMessage {
  clientMessageId: string;
  conversationId: string;
  content: string;
  replyToId: string | null;
  status: PendingStatus;
  /** Canonical message type (TEXT/IMAGE/FILE/…). Defaults to TEXT. */
  type?: string;
  /** Durable media metadata (storageKey/filename/mime/size) — never binary. */
  metadata?: unknown;
}

export class MessageLifecycleStore {
  private pending = new Map<string, PendingMessage>();
  private messages = new Map<string, ApiMessage>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly sendFn: (input: PendingMessage) => Promise<void>,
    private readonly timeoutMs = 10_000,
    // Connection gate: when false, sends are QUEUED (not failed) and
    // flushed by flushQueued() on reconnect. Defaults to always-connected
    // for backwards compatibility / tests.
    private readonly isConnected: () => boolean = () => true,
  ) {}

  getPending(conversationId: string): PendingMessage[] {
    return [...this.pending.values()].filter(
      (pendingMessage) => pendingMessage.conversationId === conversationId,
    );
  }

  getMessages(conversationId: string): ApiMessage[] {
    return [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort((firstMessage, secondMessage) => firstMessage.sequence - secondMessage.sequence);
  }

  /**
   * Optimistic add + publish + arm reconciliation timeout.
   * MQTT disconnected → QUEUED (never an uncaught "MQTT not connected"),
   * bounded by the same reconciliation timeout so a message can never stay
   * queued forever; flushQueued() publishes it on reconnect.
   */
  async send(input: Omit<PendingMessage, "status">): Promise<void> {
    const status: PendingStatus = this.isConnected() ? "pending" : "queued";
    const pending: PendingMessage = { ...input, status };
    this.pending.set(input.clientMessageId, pending);
    if (status === "queued") {
      this.armTimeout(input.clientMessageId);
      return;
    }
    try {
      await this.sendFn(pending);
    } catch {
      this.markFailed(input.clientMessageId);
      return;
    }
    this.armTimeout(input.clientMessageId);
  }

  /** Publish everything queued while offline (call on reconnect → connected). */
  async flushQueued(): Promise<void> {
    const queuedMessages = [...this.pending.values()].filter(
      (pendingMessage) => pendingMessage.status === "queued",
    );
    for (const queuedMessage of queuedMessages) {
      const pendingMessage: PendingMessage = { ...queuedMessage, status: "pending" };
      this.pending.set(queuedMessage.clientMessageId, pendingMessage);
      try {
        await this.sendFn(pendingMessage);
        this.armTimeout(queuedMessage.clientMessageId);
      } catch {
        this.markFailed(queuedMessage.clientMessageId);
      }
    }
  }

  /** Canonical event arrived → reconcile by clientMessageId. */
  reconcile(clientMessageId: string, message: ApiMessage): void {
    this.pending.delete(clientMessageId);
    this.clearTimeout(clientMessageId);
    // Upsert by id → no duplicate bubbles on QoS1 redelivery.
    this.messages.set(message.id, message);
  }

  applyHistory(messages: ApiMessage[]): void {
    // A history response can race a newer canonical event. Never replace an
    // already-reconciled row with the older request snapshot.
    for (const message of messages) {
      if (!this.messages.has(message.id)) this.messages.set(message.id, message);
    }
  }

  markFailed(clientMessageId: string): void {
    const pendingMessage = this.pending.get(clientMessageId);
    if (pendingMessage) {
      this.pending.set(clientMessageId, { ...pendingMessage, status: "failed" });
    }
    this.clearTimeout(clientMessageId);
  }

  /** Retry re-publishes the SAME clientMessageId (backend dedupes). */
  async retry(clientMessageId: string): Promise<void> {
    const pendingMessage = this.pending.get(clientMessageId);
    if (!pendingMessage || pendingMessage.status === "pending") return;
    this.pending.set(clientMessageId, { ...pendingMessage, status: "pending" });
    try {
      await this.sendFn(pendingMessage);
      this.armTimeout(clientMessageId);
    } catch {
      this.markFailed(clientMessageId);
    }
  }

  /** Clear all armed timeouts (used by tests / teardown). */
  dispose(): void {
    for (const timeout of this.timeouts.values()) clearTimeout(timeout);
    this.timeouts.clear();
  }

  private armTimeout(clientMessageId: string): void {
    this.clearTimeout(clientMessageId);
    this.timeouts.set(
      clientMessageId,
      setTimeout(() => this.markFailed(clientMessageId), this.timeoutMs),
    );
  }

  private clearTimeout(clientMessageId: string): void {
    const timeout = this.timeouts.get(clientMessageId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(clientMessageId);
    }
  }
}
