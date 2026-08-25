/**
 * Platform-agnostic message lifecycle state machine (mirrors the web
 * chat-store semantics): optimistic pending → reconciled by clientMessageId,
 * timeout → failed, retry re-publishes the SAME clientMessageId.
 * Pure TypeScript — unit-testable with jest, no React/RN imports.
 */

import type { ApiMessage } from '../../lib/api';

export type PendingStatus = 'queued' | 'pending' | 'failed';

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
      p => p.conversationId === conversationId,
    );
  }

  getMessages(conversationId: string): ApiMessage[] {
    return [...this.messages.values()]
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Optimistic add + publish + arm reconciliation timeout.
   * MQTT disconnected → QUEUED (never an uncaught "MQTT not connected"),
   * bounded by the same reconciliation timeout so a message can never stay
   * queued forever; flushQueued() publishes it on reconnect.
   */
  async send(input: Omit<PendingMessage, 'status'>): Promise<void> {
    const status: PendingStatus = this.isConnected() ? 'pending' : 'queued';
    const pending: PendingMessage = { ...input, status };
    this.pending.set(input.clientMessageId, pending);
    if (status === 'queued') {
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
    const queued = [...this.pending.values()].filter(
      p => p.status === 'queued',
    );
    for (const p of queued) {
      const asPending: PendingMessage = { ...p, status: 'pending' };
      this.pending.set(p.clientMessageId, asPending);
      try {
        await this.sendFn(asPending);
        this.armTimeout(p.clientMessageId);
      } catch {
        this.markFailed(p.clientMessageId);
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
    for (const m of messages) {
      if (!this.messages.has(m.id)) this.messages.set(m.id, m);
    }
  }

  markFailed(clientMessageId: string): void {
    const p = this.pending.get(clientMessageId);
    if (p) this.pending.set(clientMessageId, { ...p, status: 'failed' });
    this.clearTimeout(clientMessageId);
  }

  /** Retry re-publishes the SAME clientMessageId (backend dedupes). */
  async retry(clientMessageId: string): Promise<void> {
    const p = this.pending.get(clientMessageId);
    if (!p || p.status === 'pending') return;
    this.pending.set(clientMessageId, { ...p, status: 'pending' });
    try {
      await this.sendFn(p);
      this.armTimeout(clientMessageId);
    } catch {
      this.markFailed(clientMessageId);
    }
  }

  /** Clear all armed timeouts (used by tests / teardown). */
  dispose(): void {
    for (const t of this.timeouts.values()) clearTimeout(t);
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
    const t = this.timeouts.get(clientMessageId);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(clientMessageId);
    }
  }
}
