import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiConversation } from '../lib/api';
import type { ConnectionStatus } from '@mqtt-chat/realtime-core';

export function ConversationListScreen({
  conversations,
  presence,
  status,
  onOpen,
}: {
  conversations: ApiConversation[];
  presence: Record<string, boolean>;
  status: ConnectionStatus;
  onOpen: (conversationId: string) => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
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
        renderItem={({ item }) => {
          const other = item.members.find(
            m => m.userId !== undefined && m.role !== undefined,
          );
          const online = item.members.some(m => presence[m.userId] === true);
          return (
            <Pressable style={styles.item} onPress={() => onOpen(item.id)}>
              <View style={styles.avatarRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(item.title ?? other?.userId ?? '#')
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                  {online && <View style={styles.dot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.title ?? 'Direct chat'}</Text>
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
    padding: 16,
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
