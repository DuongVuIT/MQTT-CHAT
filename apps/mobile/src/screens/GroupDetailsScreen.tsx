import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type ApiConversation, type ApiUser } from '../lib/api';

/**
 * Group details (mobile): member list with presence, add-member (searchable
 * non-members), remove-member. All mutations go through the API — the
 * canonical member-joined / member-left events reconcile every client with
 * no reload. Identity is always the runtime userId.
 */
export function GroupDetailsScreen({
  conversation,
  users,
  identityUserId,
  onBack,
  onChanged,
}: {
  conversation: ApiConversation;
  users: ApiUser[];
  identityUserId: string | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const members = conversation.members ?? [];
  const memberIds = useMemo(
    () => new Set(members.map(m => m.userId)),
    [members],
  );
  const nonMembers = useMemo(
    () =>
      users.filter(
        u =>
          !memberIds.has(u.id) &&
          (filter.trim() === '' ||
            u.displayName.toLowerCase().includes(filter.trim().toLowerCase()) ||
            u.id.toLowerCase().includes(filter.trim().toLowerCase())),
      ),
    [users, memberIds, filter],
  );

  const addMember = async (userId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.addMembers(conversation.id, [userId]);
      setAdding(false);
      setFilter('');
      onChanged(); // canonical event usually lands first; refetch is a safety net
    } catch (e) {
      Alert.alert(
        'Add member failed',
        e instanceof Error ? e.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (userId: string): void => {
    const user = users.find(u => u.id === userId);
    Alert.alert(
      'Remove member',
      `Remove ${user?.displayName ?? userId} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await api.removeMember(conversation.id, userId);
                onChanged();
              } catch (e) {
                Alert.alert(
                  'Remove failed',
                  e instanceof Error ? e.message : 'Unknown error',
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {conversation.title ?? 'Group'}
          </Text>
          <Text style={styles.subtitle}>{members.length} members</Text>
        </View>
        <Pressable onPress={() => setAdding(v => !v)} hitSlop={8}>
          <Text style={styles.add}>+ Add</Text>
        </Pressable>
      </View>

      {adding && (
        <View style={styles.addPanel}>
          <TextInput
            style={styles.search}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search users not in group…"
            placeholderTextColor="#64748b"
          />
          <FlatList
            data={nonMembers}
            keyExtractor={u => u.id}
            style={{ maxHeight: 180 }}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                disabled={busy}
                onPress={() => {
                  void addMember(item.id);
                }}
              >
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.addSmall}>Add</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>Everyone is already here</Text>
            }
          />
        </View>
      )}

      <FlatList
        data={members}
        keyExtractor={m => m.userId}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        renderItem={({ item }) => {
          const user = users.find(u => u.id === item.userId);
          const isSelf = item.userId === identityUserId;
          return (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user?.displayName ?? item.userId).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {isSelf ? 'You' : (user?.displayName ?? item.userId)}
                </Text>
              </View>
              {item.role === 'ADMIN' && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>ADMIN</Text>
                </View>
              )}
              {!isSelf && (
                <Pressable
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => removeMember(item.userId)}
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No members</Text>}
      />
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color="#818cf8" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  back: { color: '#818cf8', fontSize: 16, width: 44 },
  add: {
    color: '#818cf8',
    fontSize: 15,
    fontWeight: '600',
    width: 48,
    textAlign: 'right',
  },
  headerText: { flex: 1 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 12 },
  addPanel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    gap: 8,
  },
  search: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  name: { color: '#fff', fontSize: 15, flex: 1 },
  roleBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  roleText: { color: '#fbbf24', fontSize: 10, fontWeight: '700' },
  remove: { color: '#f87171', fontSize: 13 },
  addSmall: { color: '#818cf8', fontSize: 14, fontWeight: '600' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 16 },
  busyOverlay: { position: 'absolute', top: 60, right: 20 },
});
