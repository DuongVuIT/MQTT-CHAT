import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatRealtimeClient,
  type ConnectionStatus,
  type RealtimeEvent,
} from '@mqtt-chat/realtime-core';
import {
  api,
  type ApiConversation,
  type ApiMessage,
  type ApiUser,
} from '../lib/api';
import { MQTT_WS_URL } from '../lib/config';
import { MessageLifecycleStore } from '../features/messaging/message-lifecycle';

export interface Identity {
  userId: string;
  deviceId: string;
}

/**
 * Wires the shared @mqtt-chat/realtime-core client to React state:
 * history load, realtime receive, optimistic send/retry, presence,
 * typing indicator and read receipts.
 */
export function useChatSession(identity: Identity | null) {
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [messagesByConv, setMessagesByConv] = useState<
    Record<string, ApiMessage[]>
  >({});
  const [pendingByConv, setPendingByConv] = useState<Record<string, number>>(
    {},
  );
  const [typingByConv, setTypingByConv] = useState<Record<string, string[]>>(
    {},
  );
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ChatRealtimeClient | null>(null);
  const lifecycleRef = useRef<MessageLifecycleStore | null>(null);

  const refreshPending = useCallback(() => {
    const store = lifecycleRef.current;
    if (!store) return;
    const next: Record<string, number> = {};
    for (const c of conversations) next[c.id] = store.getPending(c.id).length;
    setPendingByConv(next);
  }, [conversations]);

  // Bootstrap: users + conversations + presence snapshot.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    void (async () => {
      try {
        const [us, convs] = await Promise.all([
          api.listUsers(),
          api.listConversations(),
        ]);
        if (cancelled) return;
        setUsers(us);
        setConversations(convs);
        const ids = [
          ...new Set(convs.flatMap(c => c.members.map(m => m.userId))),
        ];
        if (ids.length > 0) {
          const snap = await api.getPresence(ids);
          if (!cancelled) {
            // Server-authoritative: absent users stay UNKNOWN (undefined),
            // never rendered as offline.
            setPresence(
              Object.fromEntries(
                Object.entries(snap).map(([k, v]) => [k, v.online]),
              ),
            );
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'bootstrap failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Realtime connection — created once per identity, handlers for page lifetime.
  useEffect(() => {
    if (!identity) return;
    const store = new MessageLifecycleStore(
      async p => {
        await clientRef.current?.sendMessage({
          conversationId: p.conversationId,
          clientMessageId: p.clientMessageId,
          type: 'TEXT',
          content: p.content,
          replyToId: p.replyToId,
          metadata: null,
        });
      },
      10_000,
      // Connection gate: while MQTT is down, sends are QUEUED (shown as
      // sending) and flushed on reconnect — never an uncaught rejection.
      () => clientRef.current?.status === 'connected',
    );
    lifecycleRef.current = store;

    const handleEvent = (ev: RealtimeEvent): void => {
      const data = ev.data ?? {};
      switch (ev.eventType) {
        case 'message.created': {
          const m = data as unknown as ApiMessage;
          store.reconcile(m.clientMessageId, m);
          setMessagesByConv(prev => {
            const list = prev[m.conversationId] ?? [];
            if (list.some(x => x.id === m.id)) return prev; // dedupe QoS1
            return {
              ...prev,
              [m.conversationId]: [...list, m].sort(
                (a, b) => a.sequence - b.sequence,
              ),
            };
          });
          refreshPending();
          break;
        }
        case 'message.edited': {
          const { messageId, content } = data as {
            messageId: string;
            content: string;
          };
          setMessagesByConv(prev => {
            const out: typeof prev = {};
            for (const [cid, list] of Object.entries(prev)) {
              out[cid] = list.map(m =>
                m.id === messageId
                  ? { ...m, content, editedAt: new Date().toISOString() }
                  : m,
              );
            }
            return out;
          });
          break;
        }
        case 'message.deleted': {
          const { messageId } = data as { messageId: string };
          setMessagesByConv(prev => {
            const out: typeof prev = {};
            for (const [cid, list] of Object.entries(prev)) {
              out[cid] = list.map(m =>
                m.id === messageId
                  ? { ...m, deletedAt: new Date().toISOString() }
                  : m,
              );
            }
            return out;
          });
          break;
        }
        case 'typing.started':
        case 'typing.stopped': {
          const { conversationId, userId } = data as {
            conversationId: string;
            userId: string;
          };
          setTypingByConv(prev => {
            const list = new Set(prev[conversationId] ?? []);
            if (ev.eventType === 'typing.started') list.add(userId);
            else list.delete(userId);
            return { ...prev, [conversationId]: [...list] };
          });
          break;
        }
        case 'presence.online':
        case 'presence.offline': {
          const { userId } = data as { userId: string };
          setPresence(prev => ({
            ...prev,
            [userId]: ev.eventType === 'presence.online',
          }));
          break;
        }
        default:
          break;
      }
    };

    const client = new ChatRealtimeClient({
      url: MQTT_WS_URL,
      identity,
      onStatus: setStatus,
      onEvent: handleEvent,
    });
    clientRef.current = client;
    void client.connect().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'MQTT connect failed');
    });

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [identity, refreshPending]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      try {
        const res = await api.getMessages(conversationId);
        lifecycleRef.current?.applyHistory(res.messages);
        setMessagesByConv(prev => ({
          ...prev,
          [conversationId]: res.messages,
        }));
        const lastSeq = res.messages[res.messages.length - 1]?.sequence ?? 0;
        if (lastSeq > 0 && identity) {
          // Best-effort: drop silently when MQTT is down (no unhandled
          // rejection); the next open/reconnect re-publishes the watermark.
          clientRef.current?.markRead(conversationId, lastSeq).catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'history load failed');
      }
    },
    [identity],
  );

  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      if (!identity || !lifecycleRef.current) return;
      const clientMessageId =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      await lifecycleRef.current.send({
        clientMessageId,
        conversationId,
        content,
        replyToId: null,
      });
      refreshPending();
    },
    [identity, refreshPending],
  );

  const retryMessage = useCallback(
    async (clientMessageId: string) => {
      await lifecycleRef.current?.retry(clientMessageId);
      refreshPending();
    },
    [refreshPending],
  );

  const sendTyping = useCallback(
    (conversationId: string, isTyping: boolean) => {
      // Ephemeral signal — safe to drop when disconnected.
      clientRef.current?.setTyping(conversationId, isTyping).catch(() => {});
    },
    [],
  );

  const pendingListFor = useCallback(
    (conversationId: string) =>
      lifecycleRef.current?.getPending(conversationId) ?? [],
    [],
  );

  // Reconnect catch-up: after a drop, MQTT QoS1 redelivery can miss events
  // published while offline. On transition → connected, re-fetch history for
  // every conversation we have already opened; upsert dedupes by id.
  const prevStatusRef = useRef<ConnectionStatus>('offline');
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status !== 'connected' || prev === 'connected') return;
    // Flush messages queued while offline (bounded by the lifecycle timeout;
    // publish failures inside flush are caught and marked failed).
    void lifecycleRef.current?.flushQueued().catch(() => {
      /* per-message failures already marked failed */
    });
    const opened = Object.keys(messagesByConv);
    if (opened.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const cid of opened) {
        try {
          const res = await api.getMessages(cid);
          if (cancelled) return;
          lifecycleRef.current?.applyHistory(res.messages);
          setMessagesByConv(prevMap => ({
            ...prevMap,
            [cid]: res.messages,
          }));
        } catch {
          // Keep stale data; next reconnect retries.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, messagesByConv]);

  return useMemo(
    () => ({
      status,
      users,
      conversations,
      messagesByConv,
      pendingByConv,
      typingByConv,
      presence,
      error,
      openConversation,
      sendMessage,
      retryMessage,
      sendTyping,
      pendingListFor,
    }),
    [
      status,
      users,
      conversations,
      messagesByConv,
      pendingByConv,
      typingByConv,
      presence,
      error,
      openConversation,
      sendMessage,
      retryMessage,
      sendTyping,
      pendingListFor,
    ],
  );
}
