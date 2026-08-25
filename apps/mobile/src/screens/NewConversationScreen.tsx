import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
import { api, type ApiUser } from "@app/lib/api";

/**
 * New conversation flow (§23) — intent-first:
 *
 *   New conversation
 *   [ Message someone ]
 *   [ Create a group ]
 *
 *   DIRECT : search → tap exactly one person → create/open (server reuses
 *            the canonical directPairKey — never a duplicate).
 *   GROUP  : name + searchable multi-select (Set<userId>) → Create group.
 */
export function NewConversationScreen({
  users,
  identityUserId,
  onBack,
  onCreated,
}: {
  users: ApiUser[];
  identityUserId: string | null;
  onBack: () => void;
  onCreated: (conversation: Awaited<ReturnType<typeof api.createConversation>>) => void;
}) {
  const [mode, setMode] = useState<"choose" | "direct" | "group">("choose");
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("");
  // Identity = Set<userId> — never display names.
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const visibleUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.id !== identityUserId &&
          (filter.trim() === "" ||
            user.displayName.toLowerCase().includes(filter.trim().toLowerCase())),
      ),
    [users, filter, identityUserId],
  );

  const toggleUser = (userId: string, isSelected: boolean): void => {
    setSelectedUserIds((previousIds) => {
      const nextIds = new Set(previousIds);
      if (isSelected) nextIds.add(userId);
      else nextIds.delete(userId);
      return nextIds;
    });
  };

  const createDirect = async (peerId: string): Promise<void> => {
    if (!identityUserId || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const conversation = await api.createConversation({
        type: "DIRECT",
        createdBy: identityUserId,
        memberIds: [identityUserId, peerId],
      });
      onCreated(conversation);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to open conversation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const createGroup = async (): Promise<void> => {
    if (!identityUserId || selectedUserIds.size < 2 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const conversation = await api.createConversation({
        type: "GROUP",
        title: title.trim() || undefined,
        createdBy: identityUserId,
        memberIds: [identityUserId, ...selectedUserIds],
      });
      onCreated(conversation);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create group");
    } finally {
      setIsSubmitting(false);
    }
  };

  const headerTitle =
    mode === "direct" ? "New message" : mode === "group" ? "New group" : "New conversation";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader
        title={headerTitle}
        onBack={() => {
          if (mode === "choose") onBack();
          else {
            setMode("choose");
            setSelectedUserIds(new Set());
            setFilter("");
            setTitle("");
            setError(null);
          }
        }}
      />

      {mode === "choose" ? (
        <View style={styles.choose}>
          <Text style={styles.chooseHint}>What do you want to start?</Text>
          <Pressable
            style={({ pressed }) => [styles.intentCard, pressed && styles.intentPressed]}
            onPress={() => setMode("direct")}
            accessibilityRole="button"
            accessibilityLabel="New direct message"
          >
            <View style={[styles.intentIconWrap, { backgroundColor: colors.primarySoft }]}>
              <Text style={styles.intentIcon}>DM</Text>
            </View>
            <View style={styles.intentBody}>
              <Text style={styles.intentTitle}>Message someone</Text>
              <Text style={styles.intentText}>Private one-on-one conversation.</Text>
            </View>
            <Text style={styles.intentChevron}>›</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.intentCard, pressed && styles.intentPressed]}
            onPress={() => setMode("group")}
            accessibilityRole="button"
            accessibilityLabel="Create a group"
          >
            <View style={[styles.intentIconWrap, { backgroundColor: colors.successSoft }]}>
              <Text style={styles.intentIcon}>GR</Text>
            </View>
            <View style={styles.intentBody}>
              <Text style={styles.intentTitle}>Create a group</Text>
              <Text style={styles.intentText}>Bring several people into one chat.</Text>
            </View>
            <Text style={styles.intentChevron}>›</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {mode === "group" && (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Group name"
                placeholderTextColor={colors.textMuted}
                maxLength={80}
                accessibilityLabel="Group name"
              />
            </View>
          )}
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={filter}
              onChangeText={setFilter}
              placeholder={mode === "group" ? "Add members…" : "Search people…"}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={mode === "group" ? "Search members" : "Search people"}
            />
            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          {mode === "group" && selectedUserIds.size > 0 && (
            <View style={styles.chosenWrap}>
              <Text style={styles.chosenLabel}>{selectedUserIds.size} selected</Text>
              <View style={styles.chosenRow}>
                {[...selectedUserIds].map((userId) => {
                  const user = users.find((candidate) => candidate.id === userId);
                  const avatarColors = avatarColorFor(userId);
                  return (
                    <Pressable
                      key={userId}
                      style={[styles.chip, { backgroundColor: avatarColors.bg }]}
                      onPress={() => toggleUser(userId, false)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${user?.displayName ?? userId}`}
                    >
                      <Text style={styles.chipText}>
                        {initialsFromDisplayName(user?.displayName)}
                      </Text>
                      <Text style={styles.chipClose}>✕</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <FlatList
            data={visibleUsers}
            keyExtractor={(user) => user.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => {
              const avatarColors = avatarColorFor(item.id);
              return mode === "direct" ? (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  disabled={isSubmitting}
                  onPress={() => {
                    void createDirect(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${item.displayName}`}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColors.bg }]}>
                    <Text style={styles.avatarText}>
                      {initialsFromDisplayName(item.displayName)}
                    </Text>
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={styles.openHint}>Chat</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => toggleUser(item.id, !selectedUserIds.has(item.id))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selectedUserIds.has(item.id) }}
                  accessibilityLabel={`Add ${item.displayName}`}
                >
                  <View
                    style={[styles.checkbox, selectedUserIds.has(item.id) && styles.checkboxOn]}
                  >
                    {selectedUserIds.has(item.id) && <Text style={styles.check}>✓</Text>}
                  </View>
                  <View style={[styles.avatar, { backgroundColor: avatarColors.bg }]}>
                    <Text style={styles.avatarText}>
                      {initialsFromDisplayName(item.displayName)}
                    </Text>
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No people match</Text>}
          />

          {mode === "group" && (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 10, 16) }]}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.primaryStrong} />
              ) : (
                <Pressable
                  style={[styles.createBtn, selectedUserIds.size < 2 && styles.disabled]}
                  disabled={selectedUserIds.size < 2}
                  onPress={() => {
                    void createGroup();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Create group"
                >
                  <Text style={styles.createText}>
                    Create group
                    {selectedUserIds.size > 0 ? ` · ${selectedUserIds.size + 1}` : ""}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  choose: { padding: spacing.lg, gap: spacing.md },
  chooseHint: {
    ...typography.subtitle,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  intentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  intentPressed: { backgroundColor: colors.surfaceHigh },
  intentIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  intentIcon: { color: colors.primaryStrong, fontSize: 12, fontWeight: "800" },
  intentBody: { flex: 1, gap: 2 },
  intentTitle: { ...typography.title, color: colors.textPrimary },
  intentText: { ...typography.caption, color: colors.textSecondary },
  intentChevron: { color: colors.textMuted, fontSize: 20, fontWeight: "600" },
  form: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 13 },
  chosenWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 6 },
  chosenLabel: { ...typography.meta, color: colors.textMuted },
  chosenRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
  },
  chipText: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
  chipClose: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    minHeight: 60,
  },
  rowPressed: { backgroundColor: colors.surface },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textPrimary, fontWeight: "700" },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  openHint: { color: colors.primaryStrong, fontSize: 13, fontWeight: "600" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 24 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: TOUCH_TARGET + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  createText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
});
