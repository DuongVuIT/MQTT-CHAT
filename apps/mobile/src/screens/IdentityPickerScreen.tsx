import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initialsFromDisplayName } from '@mqtt-chat/realtime-core';
import type { ApiUser } from '../lib/api';
import {
  avatarColorFor,
  colors,
  radius,
  spacing,
  typography,
} from '../theme/tokens';

/**
 * Identity picker — safe-area correct (nothing under the notch/Dynamic
 * Island), product-styled. This demo has no auth: picking an identity IS the
 * sign-in. Test-fixture ids (fx…/e2e-…) are filtered so automated users
 * never show up as pickable demo identities.
 */
export function IdentityPickerScreen({
  users,
  onPick,
}: {
  users: ApiUser[];
  onPick: (userId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = users.filter(
    u => !u.id.startsWith('fx') && !u.id.startsWith('e2e-'),
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>💬</Text>
        </View>
      </View>
      <Text style={styles.title}>MQTT Chat</Text>
      <Text style={styles.subtitle}>Choose who you are to start chatting</Text>
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {visible.map(u => {
          const c = avatarColorFor(u.id);
          return (
            <Pressable
              key={u.id}
              style={({ pressed }) => [
                styles.item,
                pressed && styles.itemPressed,
              ]}
              onPress={() => onPick(u.id)}
              accessibilityRole="button"
              accessibilityLabel={`Continue as ${u.displayName}`}
            >
              <View style={[styles.avatar, { backgroundColor: c.bg }]}>
                <Text style={styles.avatarText}>
                  {initialsFromDisplayName(u.displayName)}
                </Text>
              </View>
              <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
                {u.displayName}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
        {visible.length === 0 && (
          <Text style={styles.empty}>No users available</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.sm + 2,
  },
  brandRow: { marginBottom: spacing.xs },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { fontSize: 30 },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: {
    ...typography.subtitle,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  list: { alignItems: 'center', gap: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.lg,
    width: 300,
    minHeight: 64,
  },
  itemPressed: { backgroundColor: colors.surfaceHigh },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  name: { ...typography.title, color: colors.textPrimary, flex: 1 },
  chevron: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },
  empty: { color: colors.textMuted, marginTop: 24 },
});
