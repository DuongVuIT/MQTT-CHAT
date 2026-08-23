import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
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
 * Chat screen — professional chat UX:
 *  - header below the safe-area top (never under clock/Dynamic Island)
 *  - composer above home indicator + keyboard
 *  - bubbles max-width ~75%, consecutive sender grouping (no repeated
 *    sender labels), clean timestamps, explicit failed/retry state.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Resolve an IMAGE message to a fetchable URI from its durable storageKey. */
function imageUri(message: ApiMessage): string | null {
  const meta = message.metadata as Record<string, unknown> | null;
  const key =
    meta && typeof meta['storageKey'] === 'string' ? meta['storageKey'] : null;
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return mediaUrl(key);
}

export function ChatScreen({
  title,
  subtitle,
  messages,
  pending,
  typingUsers,
  identityUserId,
  onSend,
  onRetry,
  onBack,
  onTypingChange,
}: {
  title: string;
  subtitle?: string;
  messages: ApiMessage[];
  pending: PendingMessage[];
  typingUsers: string[];
  identityUserId: string | null;
  onSend: (content: string) => void;
  onRetry: (clientMessageId: string) => void;
  onBack: () => void;
  onTypingChange: (isTyping: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
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
    onSend(content);
    setDraft('');
    onTypingChange(false);
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
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
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
          const uri =
            !item.deletedAt && item.type === 'IMAGE' ? imageUri(item) : null;
          // Defensive: normalized messages always carry reactions: [], but a
          // malformed/legacy row must never crash the whole FlatList. Drift
          // stays visible in dev instead of being silently swallowed.
          const reactions = item.reactions ?? [];
          if (__DEV__ && item.reactions === undefined) {
            console.warn(
              '[ChatScreen] message without reactions reached the UI — contract drift',
              item.id,
            );
          }
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
              <View style={[styles.bubble, mine ? styles.own : styles.their]}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    style={styles.image}
                    resizeMode="cover"
                    accessible
                    accessibilityLabel={String(
                      (item.metadata as Record<string, unknown>)?.[
                        'filename'
                      ] ?? 'image',
                    )}
                  />
                ) : (
                  <Text
                    style={[
                      styles.content,
                      item.deletedAt ? styles.deleted : null,
                    ]}
                  >
                    {item.deletedAt ? 'message deleted' : item.content}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  {item.editedAt && !item.deletedAt && (
                    <Text style={styles.meta}>edited</Text>
                  )}
                  {!!reactions.length && (
                    <Text style={styles.meta}>
                      {reactions.map(r => r.emoji).join(' ')}
                    </Text>
                  )}
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                </View>
              </View>
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

      {/* Composer — above keyboard AND bottom safe area / home indicator */}
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
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraft}
          placeholder="Message…"
          placeholderTextColor="#64748b"
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <Pressable
          style={styles.sendBtn}
          onPress={submit}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>➤</Text>
        </Pressable>
      </View>
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
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 3, alignItems: 'center' },
  meta: { color: '#c7d2fe', fontSize: 11 },
  time: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
  retry: { color: '#fca5a5', fontSize: 12, marginTop: 4 },
  typing: {
    color: '#94a3b8',
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: 16,
    marginVertical: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
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
});
