import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatRealtimeClient,
  normalizeMessage,
  type ConnectionStatus,
  type RealtimeEvent,
} from '@mqtt-chat/realtime-core';
import { COMMAND_TOPICS } from '@mqtt-chat/mqtt-contracts';
import {
  applyConversationEvent,
  applyMessageActivity,
  applyReactionEvent,
  type ConversationEventTypeName,
} from '../features/conversations/conversation-events';
import {
  api,
  type ApiConversation,
  type ApiMessage,
  type ApiUser,
} from '../lib/api';
import { MQTT_WS_URL } from '../lib/config';
import { MessageLifecycleStore } from '../features/messaging/message-lifecycle';

// Typing throttle (#192, parity with web Composer): ≥1s between `started`
// publishes per conversation; silence ⇒ deterministic auto-stop after 2s.
const TYPING_THROTTLE_MS = 1000;
const TYPING_AUTOSTOP_MS = 2000;
// Incoming typing TTL (§49): `typing.stopped` rides QoS0 and the server's
// Redis expiry is never re-broadcast — a lost frame would leave "X is
// typing…" stuck forever. Each `typing.started` stamps a receipt; a 2s sweep
// drops entries older than the TTL.
const TYPING_TTL_MS = 8000;
const TYPING_SWEEP_MS = 2000;
// Presence grace (§50): LWT publishes offline instantly on any drop and the
// client reconnects ~2s later — without grace every network blip flickers
// peers offline→online. Offline flips are held for this window; an online
// event inside it cancels the flip silently.
const PRESENCE_GRACE_MS = 10_000;

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
  // Bootstrap completion — the list screen distinguishes "still loading"
  // from a genuinely empty account (skeleton vs empty state, §66).
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [messagesByConv, setMessagesByConv] = useState<
    Record<string, ApiMessage[]>
  >({});
  // Pending sends live in the lifecycle store; components read them via
  // pendingListFor(). This counter just signals "pending changed" so the
  // (single) consumer re-renders — the old per-conversation recount map
  // recomputed EVERY conversation's pending list on every event for a
  // consumer that never read it.
  const [pendingVersion, setPendingVersion] = useState(0);
  const [typingByConv, setTypingByConv] = useState<Record<string, string[]>>(
    {},
  );
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [hasMoreByConv, setHasMoreByConv] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingEarlierByConv, setLoadingEarlierByConv] = useState<
    Record<string, boolean>
  >({});
  // Initial history fetch in flight per conversation — the chat screen shows
  // a skeleton instead of a false "No messages yet" (§66).
  const [loadingHistoryByConv, setLoadingHistoryByConv] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ChatRealtimeClient | null>(null);
  // Typing throttle state (#192): per-conversation last `started` publish and
  // the pending auto-stop timer.
  const typingLastSentRef = useRef(new Map<string, number>());
  const typingStopTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  // Incoming typing receipts: conversationId → (userId → last `started` ms).
  const typingSeenRef = useRef(new Map<string, Map<string, number>>());
  // Presence grace: userId → timer that will apply the offline flip.
  const presenceGraceTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const lifecycleRef = useRef<MessageLifecycleStore | null>(null);

  // Latest-conversations mirror: lets callbacks that only need to ENUMERATE
  // conversations stay reference-stable. Historical perf bug: refreshPending
  // depended on `conversations`, and applyMessageActivity allocates a fresh
  // array on every message.created — so the realtime-client effect listed
  // refreshPending in its deps and TEARD DOWN AND RECONNECTED MQTT on
  // essentially every inbound message (discarding pending sends and
  // triggering history refetch storms).
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  // Same idea for opened-conversation keys: the reconnect-heal effect must
  // not re-arm on every message array change.
  const openedConvsRef = useRef<Set<string>>(new Set());
  const messagesByConvRef = useRef(messagesByConv);
  useEffect(() => {
    openedConvsRef.current = new Set(Object.keys(messagesByConv));
    messagesByConvRef.current = messagesByConv;
  }, [messagesByConv]);

  const bumpPending = useCallback(() => setPendingVersion(v => v + 1), []);

  // ---- Incoming typing TTL sweep (§49) ------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [cid, seen] of typingSeenRef.current.entries()) {
        const alive: string[] = [];
        for (const [uid, at] of seen.entries()) {
          if (now - at < TYPING_TTL_MS) alive.push(uid);
          else seen.delete(uid);
        }
        alive.sort();
        next[cid] = alive;
        changed = true;
      }
      if (changed) setTypingByConv(next);
    }, TYPING_SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  // ---- Presence grace (§50) -------------------------------------------------
  const applyPresence = useCallback((userId: string, online: boolean) => {
    const timers = presenceGraceTimersRef.current;
    if (online) {
      const pending = timers.get(userId);
      if (pending) {
        clearTimeout(pending);
        timers.delete(userId);
      }
      setPresence(prev =>
        prev[userId] === true ? prev : { ...prev, [userId]: true },
      );
      return;
    }
    // Offline: hold the flip for the grace window — a reconnect inside it
    // cancels it, so blips never repaint the roster.
    if (timers.has(userId)) return;
    timers.set(
      userId,
      setTimeout(() => {
        timers.delete(userId);
        setPresence(prev =>
          prev[userId] === false ? prev : { ...prev, [userId]: false },
        );
      }, PRESENCE_GRACE_MS),
    );
  }, []);

  useEffect(
    () => () => {
      // Teardown: never leak grace timers across identities.
      for (const t of presenceGraceTimersRef.current.values()) clearTimeout(t);
      presenceGraceTimersRef.current.clear();
      for (const t of typingStopTimersRef.current.values()) clearTimeout(t);
      typingStopTimersRef.current.clear();
    },
    [],
  );

  // Bootstrap: users + conversations + presence snapshot.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    void (async () => {
      try {
        const [us, convs] = await Promise.all([
          api.listUsers(),
          // Identity-scoped: without userId the API returns EVERY user's
          // conversations — other people's DMs rendered as "duplicate"
          // contacts in the list (duplicate-Alice trigger on mobile).
          api.listConversations(identity?.userId),
        ]);
        if (cancelled) return;
        setUsers(us);
        setConversations(convs);
        setConversationsLoaded(true);
        const ids = [
          ...new Set(convs.flatMap(c => (c.members ?? []).map(m => m.userId))),
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
          type: p.type ?? 'TEXT',
          content: p.content,
          replyToId: p.replyToId,
          metadata: p.metadata ?? null,
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
      // The client (and this handler) is recreated per identity — no stale
      // identity closure is possible here.
      const selfUserId = identity?.userId ?? null;
      switch (ev.eventType) {
        // ---- Conversation discovery / membership (Web→Mobile realtime) ----
        // Historical P0: these cases were MISSING — groups created on Web
        // only appeared on Mobile after an app reload.
        case 'conversation.created':
        case 'conversation.updated':
        case 'conversation.deleted':
        case 'conversation.member-joined':
        case 'conversation.member-left': {
          setConversations(prev =>
            applyConversationEvent(
              prev,
              ev.eventType as ConversationEventTypeName,
              data,
              selfUserId,
            ),
          );
          break;
        }
        case 'message.created': {
          // Canonical normalization at the boundary — guarantees the UI
          // message invariants (reactions array, null-safe dates, senderName).
          // NEVER cast raw event data to the UI model.
          const m = normalizeMessage(data);
          if (!m.id || !m.conversationId) break; // malformed — ignore
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
          // Conversation list reacts to new messages in realtime: summary +
          // ordering update with NO reload.
          const preview =
            m.type === 'TEXT'
              ? m.content.slice(0, 120)
              : `[${m.type.toLowerCase()}]`;
          setConversations(prev =>
            applyMessageActivity(prev, {
              conversationId: m.conversationId,
              sequence: m.sequence,
              preview: m.content ? preview : null,
              at: m.createdAt,
            }),
          );
          bumpPending();
          break;
        }
        case 'message.edited': {
          const { messageId, content } = data as {
            messageId: string;
            content: string;
          };
          // PERF (§48): scope to the event's conversation when known — an
          // edit touches ONE message, never every cached transcript.
          const targetCid =
            typeof data['conversationId'] === 'string'
              ? data['conversationId']
              : '';
          setMessagesByConv(prev => {
            const editList = (list: ApiMessage[]): ApiMessage[] | null => {
              let changed = false;
              const next = list.map(m => {
                if (m.id !== messageId) return m;
                changed = true;
                return { ...m, content, editedAt: new Date().toISOString() };
              });
              return changed ? next : null;
            };
            if (targetCid && prev[targetCid]) {
              const next = editList(prev[targetCid]);
              return next ? { ...prev, [targetCid]: next } : prev;
            }
            const out: typeof prev = {};
            let same = true;
            for (const [cid, list] of Object.entries(prev)) {
              const next = editList(list);
              if (next) {
                out[cid] = next;
                same = false;
              } else out[cid] = list;
            }
            return same ? prev : out;
          });
          break;
        }
        case 'message.deleted': {
          const { messageId } = data as { messageId: string };
          const targetCid =
            typeof data['conversationId'] === 'string'
              ? data['conversationId']
              : '';
          setMessagesByConv(prev => {
            const deleteIn = (list: ApiMessage[]): ApiMessage[] | null => {
              let changed = false;
              const next = list.map(m => {
                if (m.id !== messageId) return m;
                changed = true;
                return { ...m, deletedAt: new Date().toISOString() };
              });
              return changed ? next : null;
            };
            if (targetCid && prev[targetCid]) {
              const next = deleteIn(prev[targetCid]);
              return next ? { ...prev, [targetCid]: next } : prev;
            }
            const out: typeof prev = {};
            let same = true;
            for (const [cid, list] of Object.entries(prev)) {
              const next = deleteIn(list);
              if (next) {
                out[cid] = next;
                same = false;
              } else out[cid] = list;
            }
            return same ? prev : out;
          });
          break;
        }
        case 'message.rejected': {
          // Authority rejected the send — fail the pending entry NOW
          // (deterministic, repair-log #27), never wait out the timeout.
          const rejectedCmid =
            typeof data['clientMessageId'] === 'string'
              ? data['clientMessageId']
              : '';
          if (rejectedCmid) {
            lifecycleRef.current?.markFailed(rejectedCmid);
            bumpPending();
          }
          break;
        }
        case 'reaction.added':
        case 'reaction.removed': {
          // Canonical reactions from ANY client (web included) land here in
          // realtime. Pure reducer — authoritative + QoS1-idempotent.
          // PERF: scope to the event's conversation when it is present and
          // cached; a no-op reducer result keeps the SAME references so
          // nothing re-renders (§48: reaction on X updates X's row only).
          const targetCid =
            typeof data['conversationId'] === 'string'
              ? data['conversationId']
              : '';
          setMessagesByConv(prev => {
            if (targetCid && prev[targetCid]) {
              const next = applyReactionEvent(
                prev[targetCid],
                ev.eventType as 'reaction.added' | 'reaction.removed',
                data,
              );
              return next === prev[targetCid]
                ? prev
                : { ...prev, [targetCid]: next };
            }
            const out: typeof prev = {};
            let same = true;
            for (const [cid, list] of Object.entries(prev)) {
              out[cid] = applyReactionEvent(
                list,
                ev.eventType as 'reaction.added' | 'reaction.removed',
                data,
              );
              if (out[cid] !== list) same = false;
            }
            return same ? prev : out;
          });
          break;
        }
        case 'typing.started':
        case 'typing.stopped': {
          const { conversationId, userId } = data as {
            conversationId: string;
            userId: string;
          };
          if (userId === selfUserId) break; // self-echo (shared topic) is noise
          if (ev.eventType === 'typing.started') {
            const seen = typingSeenRef.current.get(conversationId) ?? new Map();
            seen.set(userId, Date.now());
            typingSeenRef.current.set(conversationId, seen);
            setTypingByConv(prev => {
              const list = prev[conversationId] ?? [];
              if (list.includes(userId)) return prev;
              return { ...prev, [conversationId]: [...list, userId].sort() };
            });
          } else {
            typingSeenRef.current.get(conversationId)?.delete(userId);
            setTypingByConv(prev => {
              const list = prev[conversationId] ?? [];
              if (!list.includes(userId)) return prev;
              return {
                ...prev,
                [conversationId]: list.filter(u => u !== userId),
              };
            });
          }
          break;
        }
        case 'presence.online':
        case 'presence.offline': {
          const { userId } = data as { userId: string };
          applyPresence(userId, ev.eventType === 'presence.online');
          break;
        }
        default:
          break;
      }
    };

    const client = new ChatRealtimeClient({
      url: MQTT_WS_URL,
      identity,
      // LWT: the broker publishes an offline command if the connection dies
      // uncleanly — parity with web (mobile identities must not linger as
      // online forever after a crash/kill).
      will: {
        topic: COMMAND_TOPICS.presenceSet,
        payload: JSON.stringify({
          requestId:
            globalThis.crypto?.randomUUID?.() ??
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          commandType: 'presence.set',
          version: 1,
          timestamp: new Date().toISOString(),
          actor: { userId: identity.userId, deviceId: identity.deviceId },
          data: { isOnline: false },
        }),
        qos: 1,
      },
      onStatus: setStatus,
      // Announce presence after every (re)connect — otherwise this device
      // never appears online to peers (web does the same in its shell).
      onConnect: () => {
        void client.setPresence(true).catch(() => {
          /* transient — next reconnect retries */
        });
      },
      onEvent: handleEvent,
    });
    clientRef.current = client;
    void client.connect().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'MQTT connect failed');
    });

    return () => {
      // Graceful teardown announces offline before the socket closes.
      void client
        .setPresence(false)
        .catch(() => {})
        .finally(() => client.disconnect());
      clientRef.current = null;
    };
  }, [identity, applyPresence, bumpPending]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      // Only the FIRST open of a conversation shows the loading skeleton;
      // re-opens keep cached content on screen while refreshing.
      let showSkeleton = false;
      setLoadingHistoryByConv(prev => {
        if (prev[conversationId]) return prev;
        showSkeleton = true;
        return { ...prev, [conversationId]: true };
      });
      try {
        const res = await api.getMessages(conversationId);
        lifecycleRef.current?.applyHistory(res.messages);
        setMessagesByConv(prev => ({
          ...prev,
          [conversationId]: res.messages,
        }));
        setHasMoreByConv(prev => ({
          ...prev,
          [conversationId]: res.hasMore,
        }));
        const lastSeq = res.messages[res.messages.length - 1]?.sequence ?? 0;
        if (lastSeq > 0 && identity) {
          // Best-effort: drop silently when MQTT is down (no unhandled
          // rejection); the next open/reconnect re-publishes the watermark.
          clientRef.current?.markRead(conversationId, lastSeq).catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'history load failed');
      } finally {
        if (showSkeleton) {
          setLoadingHistoryByConv(prev => ({
            ...prev,
            [conversationId]: false,
          }));
        }
      }
    },
    [identity],
  );

  /** Load one older page (cursor = oldest loaded sequence) and PREPEND it. */
  const loadOlderMessages = useCallback(
    async (conversationId: string) => {
      const existing = messagesByConv[conversationId] ?? [];
      const oldest = existing[0];
      if (!oldest || !hasMoreByConv[conversationId]) return;
      if (loadingEarlierByConv[conversationId]) return;
      setLoadingEarlierByConv(prev => ({ ...prev, [conversationId]: true }));
      try {
        const res = await api.getMessages(conversationId, {
          before: oldest.sequence,
        });
        lifecycleRef.current?.applyHistory(res.messages);
        setMessagesByConv(prev => {
          const list = prev[conversationId] ?? [];
          const known = new Set(list.map(m => m.id));
          const merged = [
            ...res.messages.filter(m => !known.has(m.id)),
            ...list,
          ];
          merged.sort((a, b) => a.sequence - b.sequence);
          return { ...prev, [conversationId]: merged };
        });
        setHasMoreByConv(prev => ({ ...prev, [conversationId]: res.hasMore }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'history load failed');
      } finally {
        setLoadingEarlierByConv(prev => ({ ...prev, [conversationId]: false }));
      }
    },
    [messagesByConv, hasMoreByConv, loadingEarlierByConv],
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      content: string,
      replyToId: string | null = null,
    ) => {
      if (!identity || !lifecycleRef.current) return;
      const clientMessageId =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      await lifecycleRef.current.send({
        clientMessageId,
        conversationId,
        content,
        replyToId,
      });
      bumpPending();
    },
    [identity, bumpPending],
  );

  /** Media message: upload already produced a durable storageKey — metadata
   *  only over MQTT (binary NEVER transits the broker). */
  const sendMediaMessage = useCallback(
    async (input: {
      conversationId: string;
      clientMessageId: string;
      type: string;
      content: string;
      replyToId: string | null;
      metadata: unknown;
      pendingContent: string;
    }) => {
      if (!identity || !lifecycleRef.current) return;
      await lifecycleRef.current.send({
        clientMessageId: input.clientMessageId,
        conversationId: input.conversationId,
        content: input.pendingContent,
        replyToId: input.replyToId,
        type: input.type,
        metadata: input.metadata,
      });
      bumpPending();
    },
    [identity, bumpPending],
  );

  const editMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      await clientRef.current
        ?.editMessage({ messageId, conversationId, content })
        .catch(() => {});
    },
    [],
  );

  const deleteMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      await clientRef.current
        ?.deleteMessage({ messageId, conversationId })
        .catch(() => {});
    },
    [],
  );

  /** Canonical add/remove reaction — idempotent server-side. */
  const toggleReaction = useCallback(
    (
      conversationId: string,
      messageId: string,
      emoji: string,
      remove: boolean,
    ) => {
      const command = remove
        ? clientRef.current?.removeReaction({
            messageId,
            conversationId,
            emoji,
          })
        : clientRef.current?.addReaction({ messageId, conversationId, emoji });
      command?.catch(() => {});
    },
    [],
  );

  /** Optimistic upsert after REST creation (realtime event dedupes by id). */
  const upsertLocalConversation = useCallback(
    (conversation: ApiConversation) => {
      setConversations(prev =>
        prev.some(c => c.id === conversation.id)
          ? prev.map(c => (c.id === conversation.id ? conversation : c))
          : [conversation, ...prev],
      );
    },
    [],
  );

  /** Safety-net refetch (mutations also reconcile via canonical events). */
  const refreshConversations = useCallback(async () => {
    const convs = await api.listConversations(identity?.userId);
    setConversations(convs);
  }, [identity?.userId]);

  const retryMessage = useCallback(
    async (clientMessageId: string) => {
      await lifecycleRef.current?.retry(clientMessageId);
      bumpPending();
    },
    [bumpPending],
  );

  const sendTyping = useCallback(
    (conversationId: string, isTyping: boolean) => {
      // Ephemeral signal — safe to drop when disconnected. THROTTLED (#192,
      // parity with web): every keystroke used to publish its own QoS1
      // command with no auto-stop, spamming the broker/worker. Now at most
      // one `started` per second per conversation, a deterministic `stopped`
      // after 2s of silence, and immediate stop on submit/blur.
      const client = clientRef.current;
      if (!client) return;
      const timers = typingStopTimersRef.current;
      const lastSentAt = typingLastSentRef.current;

      const armAutoStop = () => {
        const existing = timers.get(conversationId);
        if (existing) clearTimeout(existing);
        timers.set(
          conversationId,
          setTimeout(() => {
            timers.delete(conversationId);
            lastSentAt.delete(conversationId);
            clientRef.current?.setTyping(conversationId, false).catch(() => {});
          }, TYPING_AUTOSTOP_MS),
        );
      };

      if (!isTyping) {
        const pending = timers.get(conversationId);
        if (pending) clearTimeout(pending);
        timers.delete(conversationId);
        if (!lastSentAt.has(conversationId)) return;
        lastSentAt.delete(conversationId);
        client.setTyping(conversationId, false).catch(() => {});
        return;
      }

      const now = Date.now();
      const last = lastSentAt.get(conversationId) ?? 0;
      if (now - last >= TYPING_THROTTLE_MS) {
        lastSentAt.set(conversationId, now);
        client.setTyping(conversationId, true).catch(() => {});
      }
      armAutoStop();
    },
    [],
  );

  const pendingListFor = useCallback(
    (conversationId: string) =>
      lifecycleRef.current?.getPending(conversationId) ?? [],
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  // Reconnect catch-up: after a drop, MQTT QoS1 redelivery can miss events
  // published while offline. On transition → connected, heal every opened
  // conversation with a SEQ-SCOPED fetch (?after=<known watermark>) merged
  // by id — a full latest-50 REPLACE used to destroy paginated history and
  // drop messages that arrived mid-refetch (audit P2).
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
    // Heal the conversation LIST too: reuse/adoption DM creates emit no
    // realtime event, and QoS1 can drop list mutations published while
    // offline. Web heals the same way after reconnect.
    void refreshConversations();
    const opened = [...openedConvsRef.current];
    if (opened.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const cid of opened) {
        try {
          // Watermark as of NOW (messages may keep arriving mid-heal; the
          // upsert merge keeps anything newer).
          const cached = messagesByConvRef.current[cid] ?? [];
          const watermark = cached[cached.length - 1]?.sequence ?? 0;
          const res = await api.getMessages(
            cid,
            watermark > 0 ? { after: watermark } : undefined,
          );
          if (cancelled) return;
          lifecycleRef.current?.applyHistory(res.messages);
          setMessagesByConv(prevMap => {
            const list = prevMap[cid] ?? [];
            const known = new Set(list.map(m => m.id));
            const fresh = res.messages.filter(m => !known.has(m.id));
            if (fresh.length === 0) return prevMap;
            const merged = [...list, ...fresh].sort(
              (a, b) => a.sequence - b.sequence,
            );
            return { ...prevMap, [cid]: merged };
          });
        } catch {
          // Keep stale data; next reconnect retries.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, refreshConversations]);

  return useMemo(
    () => ({
      status,
      users,
      conversations,
      conversationsLoaded,
      messagesByConv,
      pendingVersion,
      typingByConv,
      presence,
      hasMoreByConv,
      loadingEarlierByConv,
      loadingHistoryByConv,
      loadOlderMessages,
      error,
      clearError,
      openConversation,
      sendMessage,
      sendMediaMessage,
      editMessage,
      deleteMessage,
      toggleReaction,
      upsertLocalConversation,
      refreshConversations,
      retryMessage,
      sendTyping,
      pendingListFor,
    }),
    [
      status,
      users,
      conversations,
      conversationsLoaded,
      messagesByConv,
      pendingVersion,
      typingByConv,
      presence,
      hasMoreByConv,
      loadingEarlierByConv,
      loadingHistoryByConv,
      loadOlderMessages,
      error,
      clearError,
      openConversation,
      sendMessage,
      sendMediaMessage,
      editMessage,
      deleteMessage,
      toggleReaction,
      upsertLocalConversation,
      refreshConversations,
      retryMessage,
      sendTyping,
      pendingListFor,
    ],
  );
}
