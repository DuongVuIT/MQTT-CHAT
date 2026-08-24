import React, { useMemo, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { api, type ApiConversation, type ApiUser } from '../lib/api';

/**
 * Group details (mobile): member list with presence, add-member (searchable
 * non-members), remove-member, and the group lifecycle ender — Delete Group
 * behind a destructive confirmation sheet (#12/#14). All mutations go through
 * the API — canonical member-joined/left/deleted events reconcile every
 * client with no reload. Identity is always the runtime userId.
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
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAdmin =
    identityUserId !== null &&
    (conversation.members ?? []).some(
      m => m.userId === identityUserId && m.role === 'ADMIN',
    );

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
      await api.addMembers(conversation.id, [userId], identityUserId ?? '');
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
                await api.removeMember(
                  conversation.id,
                  userId,
                  identityUserId ?? '',
                );
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

  /** Lifecycle ender (#12): tombstone the group; canonical event reconciles. */
  const deleteGroup = async (): Promise<void> => {
    if (busy || identityUserId === null) return;
    setBusy(true);
    setConfirmDelete(false);
    try {
      await api.deleteConversation(conversation.id, identityUserId);
      onDeleted(); // navigate home — conversation.deleted event cleans state
    } catch (e) {
      Alert.alert(
        'Delete failed',
        e instanceof Error ? e.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={conversation.title ?? 'Group'}
        subtitle={`${members.length} members`}
        onBack={onBack}
        right={
          <Pressable
            onPress={() => setAdding(v => !v)}
            hitSlop={8}
            accessibilityLabel="Add member"
          >
            <Text style={styles.add}>+ Add</Text>
          </Pressable>
        }
      />

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
        ListFooterComponent={
          isAdmin ? (
            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>DANGER ZONE</Text>
              <Pressable
                style={styles.deleteButton}
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

      {/* Destructive confirmation (#14) — never a single-tap delete. */}
      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setConfirmDelete(false)}
        >
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>
              Delete "{conversation.title ?? 'Group'}"?
            </Text>
            <Text style={styles.sheetBody}>
              This group will be removed for all members.
            </Text>
            <View style={styles.sheetActions}>
              <Pressable
                style={styles.sheetCancel}
                onPress={() => setConfirmDelete(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.sheetDelete}
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
  // ---- Danger zone (#14) -------------------------------------------------
  dangerZone: {
    marginTop: 16,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  dangerTitle: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  deleteButtonText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
    width: '100%',
    maxWidth: 340,
    gap: 10,
  },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetBody: { color: '#94a3b8', fontSize: 13 },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  sheetCancel: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#334155',
  },
  sheetCancelText: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  sheetDelete: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#ef4444',
  },
  sheetDeleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
