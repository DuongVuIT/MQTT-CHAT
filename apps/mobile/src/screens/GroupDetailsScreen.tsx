import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initialsFromDisplayName } from "@mqtt-chat/realtime-core";
import { ScreenHeader } from "@app/components/ScreenHeader";
import {
  avatarColorFor,
  colors,
  radius,
  spacing,
  typography,
  TOUCH_TARGET,
} from "@app/theme/tokens";
import { api, type ApiConversation, type ApiUser } from "@app/lib/api";

/**
 * Group details v2 (§22): a real product screen — group identity block,
 * Members section (avatar · name · role · consistent per-row action), add
 * member, and a quiet destructive area. No loose floating labels; every
 * mutation goes through the API — canonical events reconcile all clients.
 */
export function GroupDetailsScreen({
  conversation,
  users,
  identityUserId,
  onBack,
  onChanged,
  onDeleted,
}: {
  conversation: ApiConversation;
  users: ApiUser[];
  identityUserId: string | null;
  onBack: () => void;
  onChanged: () => void;
  /** Called after the group was deleted server-side — navigate home safely. */
  onDeleted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAdmin =
    identityUserId !== null &&
    (conversation.members ?? []).some(
      (member) => member.userId === identityUserId && member.role === "ADMIN",
    );

  const members = conversation.members ?? [];
  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const nonMembers = useMemo(
    () =>
      users.filter(
        (user) =>
          !memberIds.has(user.id) &&
          (filter.trim() === "" ||
            user.displayName.toLowerCase().includes(filter.trim().toLowerCase())),
      ),
    [users, memberIds, filter],
  );

  const addMember = async (userId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.addMembers(conversation.id, [userId], identityUserId ?? "");
      setAdding(false);
      setFilter("");
      onChanged(); // canonical event usually lands first; refetch is a safety net
    } catch (error) {
      Alert.alert("Add member failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (userId: string): void => {
    const user = users.find((candidate) => candidate.id === userId);
    Alert.alert("Remove member", `Remove ${user?.displayName ?? "this member"} from the group?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await api.removeMember(conversation.id, userId, identityUserId ?? "");
              onChanged();
            } catch (error) {
              Alert.alert(
                "Remove failed",
                error instanceof Error ? error.message : "Unknown error",
              );
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  /** Lifecycle ender: tombstone the group; canonical event reconciles. */
  const deleteGroup = async (): Promise<void> => {
    if (busy || identityUserId === null) return;
    setBusy(true);
    setConfirmDelete(false);
    try {
      await api.deleteConversation(conversation.id, identityUserId);
      onDeleted(); // navigate home — conversation.deleted event cleans state
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={conversation.title ?? "Group"}
        onBack={onBack}
        right={
          // Permission model (#38): only an ADMIN may add members — the
          // affordance is hidden for everyone else instead of inviting a
          // guaranteed 403.
          isAdmin ? (
            <Pressable
              onPress={() => setAdding((currentValue) => !currentValue)}
              style={styles.headerAction}
              accessibilityRole="button"
              accessibilityLabel="Add member"
            >
              <Text style={styles.headerActionText}>＋ Add</Text>
            </Pressable>
          ) : undefined
        }
      />

      {/* Group identity block (§22) */}
      <View style={styles.identityBlock}>
        <View style={[styles.groupAvatar, { backgroundColor: avatarColorFor(conversation.id).bg }]}>
          <Text style={styles.groupAvatarText}>
            {initialsFromDisplayName(conversation.title ?? "Group")}
          </Text>
        </View>
        <Text style={styles.groupName} numberOfLines={1}>
          {conversation.title ?? "Group"}
        </Text>
        <Text style={styles.groupMeta}>
          {members.length} {members.length === 1 ? "member" : "members"}
        </Text>
      </View>

      {adding && isAdmin && (
        <View style={styles.addPanel}>
          <TextInput
            style={styles.search}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search people to add…"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search people to add"
          />
          <FlatList
            data={nonMembers}
            keyExtractor={(user) => user.id}
            style={{ maxHeight: 190 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.addRow, pressed && styles.rowPressed]}
                disabled={busy}
                onPress={() => {
                  void addMember(item.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.displayName}`}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColorFor(item.id).bg }]}>
                  <Text style={styles.avatarText}>{initialsFromDisplayName(item.displayName)}</Text>
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.addLabel}>Add</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>Everyone is already here</Text>}
          />
        </View>
      )}

      <FlatList
        data={members}
        keyExtractor={(member) => member.userId}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        ListHeaderComponent={<Text style={styles.sectionLabel}>Members · {members.length}</Text>}
        renderItem={({ item }) => {
          const user = users.find((candidate) => candidate.id === item.userId);
          const isSelf = item.userId === identityUserId;
          const display = isSelf ? "You" : (user?.displayName ?? "Member");
          // Permission model (#38), mirroring web: an ADMIN may remove
          // OTHERS; any member may remove THEMSELVES (leave). Everyone else
          // sees no action — the server would reject it with 403 anyway.
          const canRemove = isAdmin ? !isSelf : isSelf;
          return (
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: avatarColorFor(item.userId).bg }]}>
                <Text style={styles.avatarText}>{initialsFromDisplayName(display)}</Text>
              </View>
              <View style={styles.memberMeta}>
                <Text style={styles.name} numberOfLines={1}>
                  {display}
                </Text>
              </View>
              {item.role === "ADMIN" && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>Admin</Text>
                </View>
              )}
              {canRemove && (
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    if (isSelf) {
                      Alert.alert(
                        "Leave group",
                        "You will no longer receive messages from this group.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Leave",
                            style: "destructive",
                            onPress: () => removeMember(item.userId),
                          },
                        ],
                      );
                    } else {
                      removeMember(item.userId);
                    }
                  }}
                  style={styles.memberAction}
                  accessibilityRole="button"
                  accessibilityLabel={isSelf ? "Leave group" : `Remove ${display}`}
                >
                  <Text style={isSelf ? styles.leaveText : styles.removeText}>
                    {isSelf ? "Leave" : "Remove"}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No members</Text>}
        ListFooterComponent={
          isAdmin ? (
            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Danger zone</Text>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.rowPressed]}
                disabled={busy}
                onPress={() => setConfirmDelete(true)}
                accessibilityRole="button"
                accessibilityLabel="Delete group"
              >
                <Text style={styles.deleteButtonText}>Delete Group</Text>
              </Pressable>
            </View>
          ) : undefined
        }
      />
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.primaryStrong} />
        </View>
      )}

      {/* Destructive confirmation — never a single-tap delete. */}
      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setConfirmDelete(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Delete “{conversation.title ?? "Group"}”?</Text>
            <Text style={styles.sheetBody}>
              The group is removed for all {members.length} members. Message history is kept by the
              server.
            </Text>
            <View style={styles.sheetActions}>
              <Pressable
                style={({ pressed }) => [styles.sheetCancel, pressed && styles.rowPressed]}
                onPress={() => setConfirmDelete(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.sheetDelete, pressed && styles.rowPressed]}
                onPress={() => {
                  void deleteGroup();
                }}
                accessibilityRole="button"
                accessibilityLabel="Confirm delete group"
              >
                <Text style={styles.sheetDeleteText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerAction: {
    minWidth: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActionText: {
    color: colors.primaryStrong,
    fontSize: 15,
    fontWeight: "600",
  },
  identityBlock: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupAvatar: {
    width: 76,
    height: 76,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  groupAvatarText: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "700",
  },
  groupName: { ...typography.screenTitle, color: colors.textPrimary },
  groupMeta: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: {
    ...typography.meta,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
  addPanel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 42,
    paddingVertical: 9,
    color: colors.textPrimary,
    fontSize: 15,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    minHeight: 52,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    minHeight: 56,
  },
  rowPressed: { opacity: 0.75 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textPrimary, fontWeight: "700" },
  memberMeta: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary },
  roleBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm + 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleText: { color: colors.primaryStrong, fontSize: 11, fontWeight: "700" },
  memberAction: {
    minWidth: TOUCH_TARGET - 6,
    minHeight: TOUCH_TARGET - 6,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  // Self-leave is a neutral action (web parity) — not destructive red.
  leaveText: { color: colors.primaryStrong, fontSize: 13, fontWeight: "600" },
  addLabel: { color: colors.primaryStrong, fontSize: 14, fontWeight: "600" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 16 },
  busyOverlay: {
    position: "absolute",
    bottom: 28,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  // Danger zone — quiet, not GitHub-red (§6).
  dangerZone: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.25)",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  dangerTitle: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: { color: colors.danger, fontSize: 14, fontWeight: "600" },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 340,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: { ...typography.title, color: colors.textPrimary },
  sheetBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sheetCancel: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.surfaceRaised,
    minHeight: TOUCH_TARGET - 4,
    justifyContent: "center",
  },
  sheetCancelText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  sheetDelete: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.dangerStrong,
    minHeight: TOUCH_TARGET - 4,
    justifyContent: "center",
  },
  sheetDeleteText: { color: colors.onDanger, fontSize: 14, fontWeight: "700" },
});
