import React, { useMemo, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type ApiUser } from '../lib/api';

/**
 * New conversation flow (mobile product parity):
 *   title (optional) + user search + multi-select members → Create.
 * Membership identity is ALWAYS the runtime userId (Set<string>) — display
 * names are labels only. One selected member + no title → DIRECT; otherwise
 * GROUP. Backend creation is transactional (members + outbox event atomic).
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
  onCreated: (
    conversation: Awaited<ReturnType<typeof api.createConversation>>,
  ) => void;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('');
  // Identity = Set<userId> — never display names.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      users.filter(
        u =>
          u.id !== identityUserId &&
          (filter.trim() === '' ||
            u.displayName.toLowerCase().includes(filter.trim().toLowerCase()) ||
            u.id.toLowerCase().includes(filter.trim().toLowerCase())),
      ),
    [users, filter, identityUserId],
  );

  const toggle = (userId: string, on: boolean): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const create = async (): Promise<void> => {
    if (!identityUserId || selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = title.trim();
      const isGroup = selected.size > 1 || trimmed.length > 0;
      const conversation = await api.createConversation({
        type: isGroup ? 'GROUP' : 'DIRECT',
        title: isGroup ? trimmed || undefined : undefined,
        createdBy: identityUserId,
        memberIds: [identityUserId, ...selected],
      });
      onCreated(conversation);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Failed to create conversation',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          New conversation
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Group title (optional — 1 member = direct chat)"
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={styles.input}
          value={filter}
          onChangeText={setFilter}
          placeholder="Search users…"
          placeholderTextColor="#64748b"
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <FlatList
        data={visible}
        keyExtractor={u => u.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => toggle(item.id, !selected.has(item.id))}
          >
            <View
              style={[
                styles.checkbox,
                selected.has(item.id) && styles.checkboxOn,
              ]}
            >
              {selected.has(item.id) && <Text style={styles.check}>✓</Text>}
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.displayName}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No users match</Text>}
      />

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}
      >
        {busy ? (
          <ActivityIndicator color="#818cf8" />
        ) : (
          <Pressable
            style={[styles.createBtn, selected.size === 0 && styles.disabled]}
            disabled={selected.size === 0}
            onPress={() => {
              void create();
            }}
          >
            <Text style={styles.createText}>
              Create ({selected.size} selected)
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
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
  back: { color: '#818cf8', fontSize: 16, width: 40 },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  form: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#fff',
  },
  error: { color: '#f87171', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  name: { color: '#fff', fontSize: 15 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  createBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disabled: { opacity: 0.4 },
  createText: { color: '#fff', fontWeight: '700' },
});
