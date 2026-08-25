import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiConversation, ApiUser } from '../lib/api';
import {
  initialsFromDisplayName,
  type ConnectionStatus,
} from '@mqtt-chat/realtime-core';
import {
  avatarColorFor,
  colors,
  radius,
  spacing,
  typography,
  TOUCH_TARGET,
} from '../theme/tokens';

/**
 * Conversation list v2 (§7/§8): product header — [profile avatar]
 * Conversations · search · new — with a SUBTLE connection dot that only
 * escalates to a banner while reconnecting/offline (§65). Rows show avatar,
 * peer-relative title, last message, timestamp and unread badge; internal
 * ids never render.
 */

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const Row = React.memo(function Row({
  conversation,
  title,
  presenceOnline,
  identityUserId,
  onPress,
}: {
  conversation: ApiConversation;
  title: string;
  presenceOnline: boolean | undefined;
  identityUserId: string | null;
  onPress: (id: string) => void;
}): React.JSX.Element {
  // Canonical color key = the stable conversation id for BOTH group and DM
  // rows (REG-05): hashing the peer's display title made the same user wear
  // different colors on web vs mobile and drift when a display name changes.
  const avatar = avatarColorFor(conversation.id);
  const isGroup = conversation.type === 'GROUP';
  // Unread = canonical lastSequence minus MY read watermark (§8) — never a
  // local-only counter.
  const myRead =
    conversation.members?.find(m => m.userId === identityUserId)
      ?.lastReadSequence ?? 0;
  const unread = Math.max(0, (conversation.lastSequence ?? 0) - myRead);
  const preview = conversation.lastMessagePreview ?? 'No messages yet';
  return (
    <Pressable
      onPress={() => onPress(conversation.id)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${preview}. ${
        unread > 0 ? `${unread} unread.` : ''
      }`}
    >
      <View style={[styles.avatar, { backgroundColor: avatar.bg }]}>
        <Text style={styles.avatarText}>
          {title.slice(0, isGroup ? 2 : 1).toUpperCase()}
        </Text>
        {/* Presence only where meaningful (§8): DM peers, tri-state. */}
        {!isGroup && presenceOnline === true && (
          <View style={styles.presenceDot} />
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.time, unread > 0 && styles.timeUnread]}>
            {timeLabel(conversation.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.previewRow}>
          <Text
            style={[styles.preview, unread > 0 && styles.previewUnread]}
            numberOfLines={1}
          >
            {preview}
          </Text>
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unread > 99 ? '99+' : unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});

const SkeletonRow = React.memo(function SkeletonRow(): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, styles.skeletonAvatar]} />
      <View style={styles.rowBody}>
        <View style={[styles.skeletonLine, { width: '42%' }]} />
        <View style={[styles.skeletonLine, { width: '68%', height: 12 }]} />
      </View>
    </View>
  );
});

export function ConversationListScreen({
  conversations,
  presence,
  status,
  users,
  identityUserId,
  identityDisplayName,
  loading = false,
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
  /** Bootstrap fetch still in flight → skeleton rows (§66). */
  loading?: boolean;
  onOpen: (conversationId: string) => void;
  onNew: () => void;
  onProfile: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c => {
      if (c.type === 'GROUP') {
        return (c.title ?? 'group').toLowerCase().includes(q);
      }
      const peerId = c.members?.find(m => m.userId !== identityUserId)?.userId;
      const name = userById.get(peerId ?? '')?.displayName ?? peerId ?? '';
      return name.toLowerCase().includes(q);
    });
  }, [conversations, filter, identityUserId, userById]);

  const titleFor = (c: ApiConversation): string => {
    if (c.type === 'GROUP') return c.title ?? 'Group';
    const peerId = c.members?.find(m => m.userId !== identityUserId)?.userId;
    // Never a generic "Direct chat" when any peer information exists.
    return userById.get(peerId ?? '')?.displayName ?? peerId ?? 'Direct chat';
  };

  const degraded = status !== 'connected';

  return (
    <View style={styles.container}>
      {/* Header (§7): profile · title+status-dot · search · new */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [
            styles.profileBtn,
            pressed && styles.pressed,
          ]}
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <Text style={styles.profileText}>
            {initialsFromDisplayName(identityDisplayName)}
          </Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Chats</Text>
          <View
            style={[
              styles.statusDot,
              status === 'connected' ? styles.dotOk : styles.dotBad,
            ]}
            accessibilityLabel={`Connection: ${status}`}
          />
        </View>
        <Pressable
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          onPress={() => {
            setSearchOpen(v => !v);
            if (searchOpen) setFilter('');
          }}
          accessibilityRole="button"
          accessibilityLabel={
            searchOpen ? 'Close search' : 'Search conversations'
          }
        >
          <Text style={styles.iconText}>⌕</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          onPress={onNew}
          accessibilityRole="button"
          accessibilityLabel="New conversation"
        >
          <Text style={styles.iconText}>＋</Text>
        </Pressable>
      </View>

      {searchOpen && (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search chats"
            placeholderTextColor={colors.textMuted}
            autoFocus
            accessibilityLabel="Search conversations"
          />
        </View>
      )}

      {/* Reconnect banner (§65) — only when NOT connected, small + non-blocking */}
      {degraded && (
        <View style={styles.reconnectBanner}>
          <View style={[styles.bannerDot, styles.dotBad]} />
          <Text style={styles.bannerText}>
            {status === 'offline'
              ? 'You’re offline — messages will send when reconnected.'
              : 'Reconnecting…'}
          </Text>
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}
        renderItem={({ item }) => {
          const peerId = item.members?.find(
            m => m.userId !== identityUserId,
          )?.userId;
          return (
            <Row
              conversation={item}
              title={titleFor(item)}
              presenceOnline={presence[peerId ?? '']}
              identityUserId={identityUserId}
              onPress={onOpen}
            />
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyBody}>
                Start a direct message or create a group.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.emptyCta,
                  pressed && styles.pressed,
                ]}
                onPress={onNew}
                accessibilityRole="button"
                accessibilityLabel="New conversation"
              >
                <Text style={styles.emptyCtaText}>New conversation</Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg - 4,
    paddingBottom: spacing.sm + 2,
    gap: spacing.sm + 2,
  },
  pressed: { opacity: 0.75 },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: { color: colors.textPrimary, ...typography.screenTitle },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: colors.success },
  dotBad: { backgroundColor: colors.warning },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: -1,
  },
  searchRow: {
    paddingHorizontal: spacing.lg - 4,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textPrimary,
    fontSize: 15,
  },
  reconnectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg - 4,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerDot: { width: 7, height: 7, borderRadius: 4 },
  bannerText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: 10,
  },
  rowPressed: { backgroundColor: colors.surface },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  presenceDot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.presenceOnline,
    borderWidth: 2,
    borderColor: colors.background,
  },
  rowBody: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    ...typography.title,
    fontSize: 15.5,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  time: { color: colors.textMuted, fontSize: 11, fontWeight: '500' },
  timeUnread: { color: colors.primaryStrong, fontWeight: '700' },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  preview: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  previewUnread: { color: colors.textPrimary, fontWeight: '500' },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: '700' },
  skeletonAvatar: { backgroundColor: colors.surface },
  skeletonLine: {
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  emptyWrap: { alignItems: 'center', marginTop: 96, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.title, color: colors.textPrimary },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyCta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 11,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  emptyCtaText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
