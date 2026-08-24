import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUrl } from '../lib/config';
import type { ApiMessage } from '../lib/api';
import type { PendingMessage } from '../features/messaging/message-lifecycle';

/**
 * Chat screen — full product surface:
 *  - safe-area header with Back / title / subtitle / Details (groups)
 *  - message list: grouped bubbles, timestamps, reactions (toggle-own),
 *    reply context, media/file cards, queued/sending/failed states
 *  - long-press action menu: Reply · React · Edit · Delete (own)
 *  - composer: attachment button, reply/edit banners, compact send
 * All actions go through canonical commands — never local-only mutations.
 */

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface MediaInfo {
  storageKey: string;
  filename: string;
  size: number;
}

/** Resolve durable media metadata from message metadata (storageKey only). */
function mediaInfo(message: ApiMessage): MediaInfo | null {
  const meta = message.metadata as Record<string, unknown> | null;
  if (!meta) return null;
  const key = meta['storageKey'];
  if (typeof key !== 'string' || key.length === 0) return null;
  return {
    storageKey: key,
    filename:
      typeof meta['filename'] === 'string' ? meta['filename'] : 'attachment',
    size: typeof meta['size'] === 'number' ? meta['size'] : 0,
  };
}

export interface ChatActions {
  send(content: string, replyToId: string | null): void;
  edit(messageId: string, content: string): void;
  delete(messageId: string): void;
  /** Toggle the active user's reaction; `remove` decides add vs remove. */
  react(messageId: string, emoji: string, remove: boolean): void;
  pickImage(): void;
  pickDocument(): void;
}

export function ChatScreen({
  title,
  subtitle,
  messages,
  pending,
  typingUsers,
  identityUserId,
  isGroup,
  actions,
  onSend,
  onRetry,
  onBack,
  onTypingChange,
  onOpenDetails,
}: {
  title: string;
  subtitle?: string;
  messages: ApiMessage[];
  pending: PendingMessage[];
  typingUsers: string[];
  identityUserId: string | null;
  isGroup: boolean;
  actions: ChatActions;
  onSend: (content: string, replyToId: string | null) => void;
  onRetry: (clientMessageId: string) => void;
  onBack: () => void;
  onTypingChange: (isTyping: boolean) => void;
  onOpenDetails: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null);
  const [editing, setEditing] = useState<ApiMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ApiMessage | null>(null);
  const [reactingFor, setReactingFor] = useState<ApiMessage | null>(null);
  const listRef = useRef<FlatList<ApiMessage>>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (messages.length > 0) {
      // scroll to newest (timer cleaned up on unmount — no post-teardown ticks)
      const timer = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [messages.length, pending.length]);

  const handleDraft = (text: string): void => {
    setDraft(text);
    onTypingChange(text.length > 0);
  };

  const submit = (): void => {
    const content = draft.trim();
    if (!content) return;
    if (editing) {
      actions.edit(editing.id, content);
      setEditing(null);
      setDraft('');
      onTypingChange(false);
      return;
    }
    onSend(content, replyTo?.id ?? null);
    setReplyTo(null);
    setDraft('');
    onTypingChange(false);
  };

  const byId = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages]);

  const toggleReactionFromChip = (message: ApiMessage, emoji: string): void => {
    const mine = (message.reactions ?? []).some(
      r => r.emoji === emoji && r.userId === identityUserId,
    );
    actions.react(message.id, emoji, mine);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header — always below the safe-area top */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Pressable
          style={styles.headerText}
          disabled={!isGroup}
          onPress={onOpenDetails}
        >
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </Pressable>
        {isGroup && (
          <Pressable onPress={onOpenDetails} hitSlop={8}>
            <Text style={styles.details}>Details</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item, index }) => {
          const mine = item.senderId === identityUserId; // perspective by runtime id
          const prev = index > 0 ? messages[index - 1] : null;
          const startsGroup =
            !prev ||
            prev.senderId !== item.senderId ||
            prev.senderType !== item.senderType;
          const info =
            !item.deletedAt && item.type !== 'TEXT' ? mediaInfo(item) : null;
          const reactions = item.reactions ?? [];
          if (__DEV__ && item.reactions === undefined) {
            console.warn(
              '[ChatScreen] message without reactions reached the UI — contract drift',
              item.id,
            );
          }
          const replySource = item.replyToId
            ? (byId.get(item.replyToId) ?? null)
            : null;
          // Group reaction chips by emoji with counts + mine flag (plain
          // computation — renderItem is not a component, no hooks here).
          const chipMap = new Map<string, { count: number; mine: boolean }>();
          for (const r of reactions) {
            const entry = chipMap.get(r.emoji) ?? { count: 0, mine: false };
            entry.count += 1;
            if (r.userId === identityUserId) entry.mine = true;
            chipMap.set(r.emoji, entry);
          }
          const chips = [...chipMap.entries()];
          return (
            <View
              style={[
                styles.bubbleWrap,
                mine ? styles.ownWrap : styles.theirWrap,
              ]}
            >
              {!mine && startsGroup && (
                <Text style={styles.sender}>{item.senderName}</Text>
              )}
              <Pressable
                onLongPress={() => setMenuFor(item)}
                delayLongPress={250}
                style={[styles.bubble, mine ? styles.own : styles.their]}
              >
                {replySource && (
                  <View style={styles.replyPreview}>
                    <Text style={styles.replyName} numberOfLines={1}>
                      {replySource.senderName}
                    </Text>
                    <Text style={styles.replyContent} numberOfLines={2}>
                      {replySource.deletedAt
                        ? 'message deleted'
                        : replySource.content || 'attachment'}
                    </Text>
                  </View>
                )}
                {item.deletedAt ? (
                  <Text style={[styles.content, styles.deleted]}>
                    message deleted
                  </Text>
                ) : info && item.type === 'IMAGE' ? (
                  <Pressable
                    onPress={() => {
                      void Linking.openURL(mediaUrl(info.storageKey));
                    }}
                  >
                    <Image
                      source={{ uri: mediaUrl(info.storageKey) }}
                      style={styles.image}
                      resizeMode="cover"
                      accessible
                      accessibilityLabel={info.filename}
                    />
                  </Pressable>
                ) : info ? (
                  <Pressable
                    style={styles.fileCard}
                    onPress={() => {
                      void Linking.openURL(mediaUrl(info.storageKey));
                    }}
                  >
                    <Text style={styles.fileIcon}>📄</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {info.filename}
                      </Text>
                      <Text style={styles.fileSize}>
                        {item.type}
                        {info.size > 0 ? ` · ${formatSize(info.size)}` : ''} ·
                        tap to open
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <Text style={styles.content}>{item.content}</Text>
                )}
                <View style={styles.metaRow}>
                  {item.editedAt && !item.deletedAt && (
                    <Text style={styles.meta}>edited</Text>
                  )}
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                </View>
              </Pressable>
              {chips.length > 0 && (
                <View style={styles.chipRow}>
                  {chips.map(([emoji, { count, mine: isMine }]) => (
                    <Pressable
                      key={emoji}
                      onPress={() => toggleReactionFromChip(item, emoji)}
                      style={[styles.chip, isMine && styles.chipMine]}
                    >
                      <Text style={styles.chipText}>
                        {emoji} {count > 1 ? count : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          <>
            {pending.map(p => (
              <View
                key={p.clientMessageId}
                style={[styles.bubbleWrap, styles.ownWrap]}
              >
                <View style={[styles.bubble, styles.own]}>
                  <Text style={styles.content}>{p.content}</Text>
                  <Text style={styles.meta}>
                    {p.status === 'failed'
                      ? 'Failed'
                      : p.status === 'queued'
                        ? 'Queued…'
                        : 'Sending…'}
                  </Text>
                  {p.status === 'failed' && (
                    <Pressable onPress={() => onRetry(p.clientMessageId)}>
                      <Text style={styles.retry}>↻ Retry</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
            {typingUsers.length > 0 && (
              <Text style={styles.typing}>
                {typingUsers.join(', ')}{' '}
                {typingUsers.length === 1 ? 'is' : 'are'} typing…
              </Text>
            )}
          </>
        }
      />

      {/* Composer — attachment + reply/edit banners + input + compact send */}
      <View
        style={[
          styles.composer,
          {
            paddingBottom: Math.max(
              insets.bottom,
              Platform.OS === 'ios' ? 10 : 6,
            ),
          },
        ]}
      >
        {(replyTo || editing) && (
          <View style={styles.banner}>
            <Text style={styles.bannerText} numberOfLines={1}>
              {editing
                ? `Editing: ${editing.content || 'attachment'}`
                : `Replying to ${replyTo?.senderName ?? ''}: ${replyTo?.content || 'attachment'}`}
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                setReplyTo(null);
                setEditing(null);
              }}
            >
              <Text style={styles.bannerClose}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composerRow}>
          <Pressable
            style={styles.attachBtn}
            onPress={() => actions.pickImage()}
            onLongPress={() => actions.pickDocument()}
            accessibilityLabel="Attach"
          >
            <Text style={styles.attachText}>📎</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={handleDraft}
            placeholder={editing ? 'Edit message…' : 'Message…'}
            placeholderTextColor="#64748b"
            onSubmitEditing={submit}
            returnKeyType="send"
            multiline
          />
          <Pressable
            style={styles.sendBtn}
            onPress={submit}
            accessibilityLabel={editing ? 'Save' : 'Send'}
          >
            <Text style={styles.sendText}>{editing ? '✓' : '➤'}</Text>
          </Pressable>
        </View>
        <Text style={styles.attachHint}>📎 tap = photo · hold = document</Text>
      </View>

      {/* Long-press action menu (cross-platform modal — no extra deps) */}
      <Modal
        visible={menuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {menuFor?.content || 'Attachment'}
            </Text>
            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map(emoji => (
                <Pressable
                  key={emoji}
                  style={styles.reactionBtn}
                  onPress={() => {
                    if (menuFor) actions.react(menuFor.id, emoji, false);
                    setMenuFor(null);
                  }}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                if (menuFor) setReplyTo(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={styles.menuItemText}>↩ Reply</Text>
            </Pressable>
            {menuFor?.senderId === identityUserId && !menuFor.deletedAt && (
              <>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    if (menuFor) {
                      setEditing(menuFor);
                      setDraft(menuFor.content);
                    }
                    setMenuFor(null);
                  }}
                >
                  <Text style={styles.menuItemText}>✎ Edit</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    if (menuFor) actions.delete(menuFor.id);
                    setMenuFor(null);
                  }}
                >
                  <Text style={[styles.menuItemText, styles.danger]}>
                    🗑 Delete
                  </Text>
                </Pressable>
              </>
            )}
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={styles.menuItemText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Reaction picker (from chip long-press / menu React) */}
      <Modal
        visible={reactingFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactingFor(null)}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setReactingFor(null)}
        >
          <View style={styles.menuSheet}>
            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map(emoji => (
                <Pressable
                  key={emoji}
                  style={styles.reactionBtn}
                  onPress={() => {
                    if (reactingFor)
                      actions.react(reactingFor.id, emoji, false);
                    setReactingFor(null);
                  }}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  back: { color: '#818cf8', fontSize: 16 },
  details: { color: '#818cf8', fontSize: 14, fontWeight: '600' },
  headerText: { flex: 1 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 12, marginTop: 1 },
  bubbleWrap: { marginHorizontal: 12, marginVertical: 2 },
  ownWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    maxWidth: '75%',
    marginTop: 4,
  },
  own: { backgroundColor: '#4f46e5', borderBottomRightRadius: 4 },
  their: { backgroundColor: '#1e293b', borderBottomLeftRadius: 4 },
  sender: { color: '#a5b4fc', fontSize: 11, marginLeft: 2 },
  content: { color: '#fff', fontSize: 15 },
  deleted: { fontStyle: 'italic', color: '#94a3b8' },
  image: {
    width: 220,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#0f172a',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
  },
  fileIcon: { fontSize: 26 },
  fileName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  fileSize: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 },
  replyPreview: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,0.5)',
    paddingLeft: 8,
    marginBottom: 6,
  },
  replyName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '700',
  },
  replyContent: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 3, alignItems: 'center' },
  meta: { color: '#c7d2fe', fontSize: 11 },
  time: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
    marginHorizontal: 2,
  },
  chip: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipMine: { backgroundColor: '#312e81', borderColor: '#6366f1' },
  chipText: { color: '#e2e8f0', fontSize: 12 },
  retry: { color: '#fca5a5', fontSize: 12, marginTop: 4 },
  typing: {
    color: '#94a3b8',
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: 16,
    marginVertical: 4,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  bannerText: { color: '#cbd5e1', fontSize: 12, flex: 1 },
  bannerClose: { color: '#94a3b8', paddingHorizontal: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachText: { fontSize: 17 },
  input: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    color: '#fff',
    minHeight: 40,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 20,
    minWidth: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 17 },
  attachHint: {
    color: '#475569',
    fontSize: 10,
    textAlign: 'center',
    paddingVertical: 3,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  menuTitle: {
    color: '#94a3b8',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  reactionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  reactionBtn: { padding: 6 },
  reactionEmoji: { fontSize: 26 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 13 },
  menuItemText: { color: '#e2e8f0', fontSize: 16 },
  danger: { color: '#f87171' },
});
