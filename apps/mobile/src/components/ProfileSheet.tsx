import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initialsFromDisplayName, type ConnectionStatus } from "@mqtt-chat/realtime-core";
import { avatarColorFor, colors, radius, spacing, typography } from "@app/theme/tokens";

const STATUS_LABEL: Record<ConnectionStatus, { label: string; color: string }> = {
  connected: { label: "Connected", color: colors.success },
  connecting: { label: "Connecting…", color: colors.warning },
  reconnecting: { label: "Reconnecting…", color: colors.warning },
  offline: { label: "Offline", color: colors.danger },
};

/**
 * Profile sheet (§24): the avatar button opens ONE place with the current
 * profile, live connection state and Switch profile — no confusing screens.
 * Raw ids/device ids appear only in dev builds (diagnostics, §24/§33).
 */
export function ProfileSheet({
  visible,
  displayName,
  userId,
  deviceId,
  status,
  onClose,
  onSwitch,
}: {
  visible: boolean;
  displayName: string;
  userId: string;
  deviceId: string;
  status: ConnectionStatus;
  onClose: () => void;
  onSwitch: () => void;
}) {
  const insets = useSafeAreaInsets();
  const avatar = avatarColorFor(userId);
  const statusInfo = STATUS_LABEL[status] ?? STATUS_LABEL.offline;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <View style={styles.profileRow}>
            <View
              testID="profile-sheet-avatar"
              style={[styles.avatar, { backgroundColor: avatar.bg }]}
            >
              <Text style={[styles.avatarText, { color: avatar.fg }]}>
                {initialsFromDisplayName(displayName)}
              </Text>
            </View>
            <View style={styles.profileMeta}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
                <Text style={styles.statusText}>{statusInfo.label}</Text>
              </View>
            </View>
          </View>

          {__DEV__ && (
            <View style={styles.devBox}>
              <Text style={styles.devLabel}>Development diagnostics</Text>
              <Text style={styles.devText} numberOfLines={1}>
                user {userId}
              </Text>
              <Text style={styles.devText} numberOfLines={1}>
                device {deviceId}
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            onPress={onSwitch}
            accessibilityRole="button"
            accessibilityLabel="Switch profile"
          >
            <Text style={styles.actionIcon}>⇄</Text>
            <Text style={styles.actionText}>Switch profile</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close profile"
          >
            <Text style={styles.cancelText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: 2,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: 6,
    paddingVertical: spacing.sm,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textPrimary, fontSize: 20, fontWeight: "700" },
  profileMeta: { flex: 1, gap: 3 },
  name: { color: colors.textPrimary, ...typography.title },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textSecondary, fontSize: 12, fontWeight: "500" },
  devBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 2,
    marginBottom: spacing.sm,
  },
  devLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  devText: { color: colors.textSecondary, fontSize: 12 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    borderRadius: radius.md,
  },
  actionPressed: { backgroundColor: colors.surfaceHigh },
  actionIcon: { fontSize: 17, width: 22, color: colors.textSecondary },
  actionText: { color: colors.textPrimary, fontSize: 15 },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 48,
  },
  cancelText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
});
