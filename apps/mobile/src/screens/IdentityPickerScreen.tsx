import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiUser } from '../lib/api';

export function IdentityPickerScreen({
  users,
  onPick,
}: {
  users: ApiUser[];
  onPick: (userId: string) => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>MQTT Chat</Text>
      <Text style={styles.subtitle}>Pick a demo identity</Text>
      {users.map(u => (
        <Pressable key={u.id} style={styles.item} onPress={() => onPick(u.id)}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {u.displayName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{u.displayName}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    gap: 12,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#94a3b8', marginBottom: 16 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1e293b',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    width: 240,
  },
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
});
