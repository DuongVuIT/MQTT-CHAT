import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ApiConversation, ApiUser } from "@app/lib/api";
import { initialsFromDisplayName, type ConnectionStatus } from "@mqtt-chat/realtime-core";
import {
  avatarColorFor,
  colors,
  radius,
  spacing,
  typography,
  TOUCH_TARGET,
} from "@app/theme/tokens";

/**
 * Conversation list v2 (§7/§8): product header — [profile avatar]
 * Conversations · search · new — with a SUBTLE connection dot that only
 * escalates to a banner while reconnecting/offline (§65). Rows show avatar,
 * peer-relative title, last message, timestamp and unread badge; internal
 * ids never render.
 */

function timeLabel(timestamp: string | null | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const Row = React.memo(function Row({
  conversation,
  title,
  avatarColorKey,
  presenceOnline,
  identityUserId,
  onPress,
}: {
  conversation: ApiConversation;
  title: string;
  avatarColorKey: string;
  presenceOnline: boolean | undefined;
  identityUserId: string | null;
  onPress: (id: string) => void;
}): React.JSX.Element {
  // A DIRECT row represents the peer user; a GROUP row represents the
  // conversation. The caller supplies the matching stable identity key.
  const avatar = avatarColorFor(avatarColorKey);
  const isGroup = conversation.type === "GROUP";
  // Unread = canonical lastSequence minus MY read watermark (§8) — never a
  // local-only counter.
  const lastReadSequence =
    conversation.members?.find((member) => member.userId === identityUserId)?.lastReadSequence ?? 0;
  const unreadCount = Math.max(0, (conversation.lastSequence ?? 0) - lastReadSequence);
  const preview = conversation.lastMessagePreview ?? "No messages yet";
  return (
    <Pressable
      onPress={() => onPress(conversation.id)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${preview}. ${
        unreadCount > 0 ? `${unreadCount} unread.` : ""
      }`}
    >
      <View
        testID={`conversation-avatar-${conversation.id}`}
        style={[styles.avatar, { backgroundColor: avatar.bg }]}
      >
        <Text style={[styles.avatarText, { color: avatar.fg }]}>
          {initialsFromDisplayName(title)}
        </Text>
        {/* Presence only where meaningful (§8): DM peers, tri-state. */}
        {!isGroup && presenceOnline === true && <View style={styles.presenceDot} />}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.time, unreadCount > 0 && styles.timeUnread]}>
            {timeLabel(conversation.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.previewRow}>
          <Text style={[styles.preview, unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
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
        <View style={[styles.skeletonLine, { width: "42%" }]} />
        <View style={[styles.skeletonLine, { width: "68%", height: 12 }]} />
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
  const [filter, setFilter] = useState("");

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const visibleConversations = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return conversations;
    return conversations.filter((conversation) => {
      if (conversation.type === "GROUP") {
        return (conversation.title ?? "group").toLowerCase().includes(normalizedFilter);
      }
      const peerId = conversation.members?.find(
        (member) => member.userId !== identityUserId,
      )?.userId;
      const displayName = usersById.get(peerId ?? "")?.displayName ?? peerId ?? "";
      return displayName.toLowerCase().includes(normalizedFilter);
    });
  }, [conversations, filter, identityUserId, usersById]);

  const getConversationTitle = (conversation: ApiConversation): string => {
    if (conversation.type === "GROUP") return conversation.title ?? "Group";
    const peerId = conversation.members?.find((member) => member.userId !== identityUserId)?.userId;
    return usersById.get(peerId ?? "")?.displayName ?? peerId ?? "Direct chat";
  };

  const degraded = status !== "connected";
  const identityAvatar = avatarColorFor(identityUserId ?? "?");

  return (
    <View style={styles.container}>
      {/* Header (§7): profile · title+status-dot · search · new */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="profile-avatar"
          style={({ pressed }) => [
            styles.profileBtn,
            { backgroundColor: identityAvatar.bg },
            pressed && styles.pressed,
          ]}
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <Text style={[styles.profileText, { color: identityAvatar.fg }]}>
            {initialsFromDisplayName(identityDisplayName)}
          </Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.eyebrow}>WORKSPACE</Text>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Messages</Text>
            <View
              style={[styles.statusDot, status === "connected" ? styles.dotOk : styles.dotBad]}
              accessibilityLabel={`Connection: ${status}`}
            />
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          onPress={() => {
            setSearchOpen((currentValue) => !currentValue);
            if (searchOpen) setFilter("");
          }}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? "Close search" : "Search conversations"}
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
            {status === "offline"
              ? "You’re offline — messages will send when reconnected."
              : "Reconnecting…"}
          </Text>
        </View>
      )}

      <FlatList
        data={visibleConversations}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}
        renderItem={({ item }) => {
          const peerId = item.members?.find((member) => member.userId !== identityUserId)?.userId;
          const title = getConversationTitle(item);
          return (
            <Row
              conversation={item}
              title={title}
              avatarColorKey={item.type === "GROUP" ? item.id : (peerId ?? item.id)}
              presenceOnline={presence[peerId ?? ""]}
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
              <View style={styles.emptyMark}>
                <Text style={styles.emptyMarkText}>MQ</Text>
              </View>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyBody}>Start a direct message or create a group.</Text>
              <Pressable
                style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg - 4,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.75 },
  profileBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  profileText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  headerCenter: {
    flex: 1,
    justifyContent: "center",
  },
  eyebrow: { ...typography.meta, color: colors.primaryStrong, letterSpacing: 1.2 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { color: colors.textPrimary, ...typography.screenTitle },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: colors.success },
  dotBad: { backgroundColor: colors.warning },
  iconBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "600",
    marginTop: -1,
  },
  searchRow: {
    paddingHorizontal: spacing.lg - 4,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  reconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textPrimary, fontWeight: "700", fontSize: 17 },
  presenceDot: {
    position: "absolute",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  name: {
    ...typography.title,
    fontSize: 15.5,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  time: { color: colors.textMuted, fontSize: 11, fontWeight: "500" },
  timeUnread: { color: colors.primaryStrong, fontWeight: "700" },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  preview: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  previewUnread: { color: colors.textPrimary, fontWeight: "500" },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: "700" },
  skeletonAvatar: { backgroundColor: colors.surface },
  skeletonLine: {
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  emptyWrap: { alignItems: "center", marginTop: 96, paddingHorizontal: 32 },
  emptyMark: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: spacing.lg,
  },
  emptyMarkText: { color: colors.primaryStrong, fontWeight: "800", fontSize: 16 },
  emptyTitle: { ...typography.title, color: colors.textPrimary },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
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
    justifyContent: "center",
  },
  emptyCtaText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
});
