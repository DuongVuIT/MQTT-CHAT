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
import { ScreenHeader } from '../components/ScreenHeader';
import { colors } from '../theme/tokens';
import { api, type ApiUser } from '../lib/api';

/**
 * New conversation flow (#5/#50) — TWO explicit intents instead of one
 * ambiguous form:
 *
 *   ┌ New conversation ┐
 *   │ [ Message someone ] [ Create a group ]
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
  onCreated: (
    conversation: Awaited<ReturnType<typeof api.createConversation>>,
  ) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'direct' | 'group'>('choose');
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

  const createDirect = async (peerId: string): Promise<void> => {
    if (!identityUserId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.createConversation({
        type: 'DIRECT',
        createdBy: identityUserId,
        memberIds: [identityUserId, peerId],
      });
      onCreated(conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open conversation');
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (): Promise<void> => {
    if (!identityUserId || selected.size < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.createConversation({
        type: 'GROUP',
        title: title.trim() || undefined,
        createdBy: identityUserId,
        memberIds: [identityUserId, ...selected],
      });
      onCreated(conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  const headerTitle =
    mode === 'direct'
      ? 'New direct message'
      : mode === 'group'
        ? 'New group'
        : 'New conversation';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={headerTitle}
        onBack={() => {
          if (mode === 'choose') onBack();
          else {
            setMode('choose');
            setSelected(new Set());
            setFilter('');
            setTitle('');
          }
        }}
      />

      {mode === 'choose' ? (
        <View style={styles.choose}>
          <Pressable
            style={styles.intentCard}
            onPress={() => setMode('direct')}
            accessibilityRole="button"
            accessibilityLabel="New direct message"
          >
            <Text style={styles.intentIcon}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.intentTitle}>Message someone</Text>
              <Text style={styles.intentBody}>
                Start a private one-on-one chat.
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={styles.intentCard}
            onPress={() => setMode('group')}
            accessibilityRole="button"
            accessibilityLabel="Create a group"
          >
            <Text style={styles.intentIcon}>👥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.intentTitle}>Create a group</Text>
              <Text style={styles.intentBody}>
                Bring several people into one chat.
              </Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <>
          {mode === 'group' && (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Group name"
                placeholderTextColor="#64748b"
                maxLength={80}
              />
            </View>
          )}
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={filter}
              onChangeText={setFilter}
              placeholder={
                mode === 'group' ? 'Search members…' : 'Search people…'
              }
              placeholderTextColor="#64748b"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            {mode === 'group' && selected.size > 0 && (
              <Text style={styles.selectedCount}>{selected.size} selected</Text>
            )}
          </View>

          <FlatList
            data={visible}
            keyExtractor={u => u.id}
            renderItem={({ item }) =>
              mode === 'direct' ? (
                <Pressable
                  style={styles.row}
                  disabled={busy}
                  onPress={() => {
                    void createDirect(item.id);
                  }}
                >
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
                  <Text style={styles.openHint}>Open ›</Text>
                </Pressable>
              ) : (
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
                    {selected.has(item.id) && (
                      <Text style={styles.check}>✓</Text>
                    )}
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
              )
            }
            ListEmptyComponent={
              <Text style={styles.empty}>No people match</Text>
            }
          />

          {mode === 'group' && (
            <View style={[styles.footer, { paddingBottom: Math.max(24, 10) }]}>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Pressable
                  style={[
                    styles.createBtn,
                    selected.size < 2 && styles.disabled,
                  ]}
                  disabled={selected.size < 2}
                  onPress={() => {
                    void createGroup();
                  }}
                  accessibilityLabel="Create group"
                >
                  <Text style={styles.createText}>Create group</Text>
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
  choose: { padding: 16, gap: 12 },
  intentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  intentIcon: { fontSize: 28 },
  intentTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  intentBody: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  form: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.textPrimary,
  },
  selectedCount: { color: colors.textSecondary, fontSize: 12 },
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
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  name: { color: colors.textPrimary, fontSize: 15 },
  openHint: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
