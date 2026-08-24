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
  identityDisplayName,
  onOpen,
  onNew,
  onProfile,
}: {
  conversations: ApiConversation[];
  presence: Record<string, boolean>;
  status: ConnectionStatus;
  users: ApiUser[];
  identityUserId: string | null;
  identityDisplayName: string | null;
  onOpen: (conversationId: string) => void;
  onNew: () => void;
  onProfile: () => void;
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

  const timeLabel = (c: ApiConversation): string => {
    if (!c.lastMessageAt) return '';
    const d = new Date(c.lastMessageAt);
    if (Number.isNaN(d.getTime())) return '';
    const sameDay = new Date().toDateString() === d.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {/* Profile / identity switch — complete product navigation (§40/41) */}
        <Pressable
          style={styles.profileBtn}
          onPress={onProfile}
          accessibilityLabel="Profile"
        >
          <Text style={styles.profileText}>
            {(identityDisplayName ?? identityUserId ?? '?')
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Conversations</Text>
          {/* Subtle secondary indicator (#46) — a small dot, not a pill. */}
          <View
            style={[
              styles.statusDot,
              status === 'connected' ? styles.statusOk : styles.statusBad,
            ]}
            accessibilityLabel={`Connection: ${status}`}
          />
        </View>
        <Pressable
          style={styles.newBtn}
          onPress={onNew}
          accessibilityLabel="New conversation"
        >
          <Text style={styles.newText}>＋</Text>
        </Pressable>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        renderItem={({ item }) => {
          const members = item.members ?? [];
          const peerId =
            members.find(m => m.userId !== identityUserId)?.userId ??
            members[0]?.userId;
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
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {labelFor(item)}
                    </Text>
                    {!!item.lastMessageAt && (
                      <Text style={styles.time}>{timeLabel(item)}</Text>
                    )}
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessagePreview ?? 'No messages yet'}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyBody}>
              Start a direct message or create a group.
            </Text>
            <Pressable
              style={styles.emptyCta}
              onPress={onNew}
              accessibilityLabel="New conversation"
            >
              <Text style={styles.emptyCtaText}>New conversation</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  newBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newText: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: -2 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  time: { color: '#64748b', fontSize: 11 },
  // Subtle connection indicator (#46): small dot, secondary prominence.
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  statusOk: { backgroundColor: '#34d399' },
  statusBad: { backgroundColor: '#ef4444' },
  emptyWrap: { alignItems: 'center', marginTop: 96, paddingHorizontal: 32 },
  emptyTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  emptyBody: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  emptyCta: {
    marginTop: 16,
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
