import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiConversation, ApiUser } from '../lib/api';
import type { ConnectionStatus } from '@mqtt-chat/realtime-core';

/**
 * Conversation list — safe-area header, peer-relative DIRECT labels
 * (A sees B's name, B sees A's), tri-state presence dot.
 */
export function ConversationListScreen({
  conversations,
  presence,
  status,
  users,
  identityUserId,
  onOpen,
}: {
  conversations: ApiConversation[];
  presence: Record<string, boolean>;
  status: ConnectionStatus;
  users: ApiUser[];
  identityUserId: string | null;
  onOpen: (conversationId: string) => void;
}) {
  const insets = useSafeAreaInsets();

  const labelFor = (c: ApiConversation): string => {
    if (c.type === 'GROUP') return c.title ?? 'Group';
    const members = c.members ?? [];
    const peerId = members.find(m => m.userId !== identityUserId)?.userId;
    const peer = users.find(u => u.id === peerId);
    // Never a generic "Direct chat" when any peer information exists.
    return peer?.displayName ?? peerId ?? 'Direct chat';
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Conversations</Text>
        <Text
          style={[
            styles.badge,
            status === 'connected' ? styles.badgeOk : styles.badgeBad,
          ]}
        >
          {status}
        </Text>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        renderItem={({ item }) => {
          const peerId =
            item.members.find(m => m.userId !== identityUserId)?.userId ??
            item.members[0]?.userId;
          // Tri-state: true=online, false=offline, undefined=unknown.
          const online = peerId ? presence[peerId] : undefined;
          return (
            <Pressable style={styles.item} onPress={() => onOpen(item.id)}>
              <View style={styles.avatarRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {labelFor(item).slice(0, 1).toUpperCase()}
                  </Text>
                  {online === true && <View style={styles.dot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {labelFor(item)}
                  </Text>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessagePreview ?? 'No messages yet'}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No conversations yet</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  badge: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  badgeOk: { color: '#052e16', backgroundColor: '#22c55e' },
  badgeBad: { color: '#fff', backgroundColor: '#ef4444' },
  item: { paddingHorizontal: 16, paddingVertical: 10 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  preview: { color: '#94a3b8', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});
