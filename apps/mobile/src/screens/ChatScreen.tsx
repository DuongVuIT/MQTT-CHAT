import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ApiMessage } from '../lib/api';
import type { PendingMessage } from '../features/messaging/message-lifecycle';

export function ChatScreen({
  title,
  messages,
  pending,
  typingUsers,
  onSend,
  onRetry,
  onBack,
  onTypingChange,
}: {
  title: string;
  messages: ApiMessage[];
  pending: PendingMessage[];
  typingUsers: string[];
  onSend: (content: string) => void;
  onRetry: (clientMessageId: string) => void;
  onBack: () => void;
  onTypingChange: (isTyping: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ApiMessage>>(null);

  useEffect(() => {
    if (messages.length > 0) {
      // scroll to newest
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
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
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.senderType === 'USER' ? styles.own : styles.their,
            ]}
          >
            <Text style={styles.sender}>{item.senderName}</Text>
            <Text
              style={[styles.content, item.deletedAt ? styles.deleted : null]}
            >
              {item.deletedAt ? 'message deleted' : item.content}
            </Text>
            {item.editedAt && !item.deletedAt && (
              <Text style={styles.meta}>edited</Text>
            )}
            {item.reactions.length > 0 && (
              <Text style={styles.meta}>
                {item.reactions.map(r => r.emoji).join(' ')}
              </Text>
            )}
          </View>
        )}
        ListFooterComponent={
          <>
            {pending.map(p => (
              <View key={p.clientMessageId} style={[styles.bubble, styles.own]}>
                <Text style={styles.content}>{p.content}</Text>
                {p.status === 'pending' ? (
                  <Text style={styles.meta}>Sending…</Text>
                ) : (
                  <Pressable onPress={() => onRetry(p.clientMessageId)}>
                    <Text style={styles.retry}>↻ Retry</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {typingUsers.length > 0 && (
              <Text style={styles.typing}>
                {typingUsers.join(', ')} is typing…
              </Text>
            )}
          </>
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraft}
          placeholder="Type a message…"
          placeholderTextColor="#64748b"
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <Pressable style={styles.sendBtn} onPress={submit}>
          <Text style={styles.sendText}>Send</Text>
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
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  back: { color: '#818cf8', fontSize: 16 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  bubble: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 10,
    borderRadius: 12,
    maxWidth: '80%',
  },
  own: { alignSelf: 'flex-end', backgroundColor: '#4f46e5' },
  their: { alignSelf: 'flex-start', backgroundColor: '#1e293b' },
  sender: { color: '#a5b4fc', fontSize: 11, marginBottom: 2 },
  content: { color: '#fff', fontSize: 15 },
  deleted: { fontStyle: 'italic', color: '#94a3b8' },
  meta: { color: '#c7d2fe', fontSize: 11, marginTop: 2 },
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
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  input: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
    minHeight: 40,
  },
  sendBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontWeight: '600' },
});
