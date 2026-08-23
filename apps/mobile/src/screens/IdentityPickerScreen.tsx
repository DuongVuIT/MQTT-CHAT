import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiUser } from '../lib/api';

/**
 * Identity picker — safe-area correct (nothing under the notch/Dynamic
 * Island), runtime data only, long names truncated. Test-fixture ids
 * (fx…/e2e-…) are a display-level filter so automated users never show up
 * as pickable demo identities.
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
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <Text style={styles.title}>MQTT Chat</Text>
      <Text style={styles.subtitle}>Pick a demo identity</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {visible.map(u => (
          <Pressable
            key={u.id}
            style={styles.item}
            onPress={() => onPick(u.id)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {u.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.itemText}>
              <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
                {u.displayName}
              </Text>
              <Text style={styles.id} numberOfLines={1} ellipsizeMode="middle">
                {u.id}
              </Text>
            </View>
          </Pressable>
        ))}
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
    backgroundColor: '#0f172a',
    gap: 12,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#94a3b8', marginBottom: 8 },
  list: { alignItems: 'center', gap: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1e293b',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    width: 280,
  },
  itemText: { flex: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  name: { color: '#fff', fontSize: 16 },
  id: { color: '#64748b', fontSize: 11, marginTop: 2 },
  empty: { color: '#64748b', marginTop: 24 },
});
