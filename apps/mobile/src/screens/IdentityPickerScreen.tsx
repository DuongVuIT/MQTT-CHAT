import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initialsFromDisplayName } from "@mqtt-chat/realtime-core";
import type { ApiUser } from "@app/lib/api";
import { avatarColorFor, colors, radius, spacing, typography } from "@app/theme/tokens";

export function IdentityPickerScreen({
  users,
  onPick,
}: {
  users: ApiUser[];
  onPick: (userId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const visibleUsers = users.filter(
    (user) => !user.id.startsWith("fx") && !user.id.startsWith("e2e-"),
  );

  return (
    <View
      style={[styles.container, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.ambientTop} />
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>MQ</Text>
      </View>
      <Text style={styles.eyebrow}>REALTIME WORKSPACE</Text>
      <Text style={styles.title}>MQTT Chat</Text>
      <Text style={styles.subtitle}>Choose an identity to enter the workspace.</Text>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {visibleUsers.map((user) => {
          const avatarColors = avatarColorFor(user.id);
          return (
            <Pressable
              key={user.id}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => onPick(user.id)}
              accessibilityRole="button"
              accessibilityLabel={`Continue as ${user.displayName}`}
            >
              <View style={[styles.avatar, { backgroundColor: avatarColors.bg }]}>
                <Text style={[styles.avatarText, { color: avatarColors.fg }]}>
                  {initialsFromDisplayName(user.displayName)}
                </Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
                  {user.displayName}
                </Text>
                <Text style={styles.identityHint}>Open workspace</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
        {visibleUsers.length === 0 && <Text style={styles.empty}>No users available</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
  },
  ambientTop: {
    position: "absolute",
    top: -120,
    width: 320,
    height: 240,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    opacity: 0.7,
  },
  brandMark: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  brandMarkText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  eyebrow: {
    ...typography.meta,
    color: colors.primaryStrong,
    letterSpacing: 1.8,
    marginBottom: spacing.sm,
  },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: {
    ...typography.subtitle,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
    textAlign: "center",
  },
  list: { width: "100%", gap: spacing.md, paddingBottom: spacing.xl },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    width: "100%",
    minHeight: 72,
  },
  itemPressed: { backgroundColor: colors.surfaceHigh, transform: [{ scale: 0.985 }] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontWeight: "700", fontSize: 16 },
  identityText: { flex: 1 },
  name: { ...typography.title, color: colors.textPrimary },
  identityHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  chevron: { color: colors.primaryStrong, fontSize: 22, fontWeight: "600" },
  empty: { color: colors.textMuted, marginTop: 24 },
});
