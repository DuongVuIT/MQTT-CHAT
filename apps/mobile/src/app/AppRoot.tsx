import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { launchImageLibrary, type Asset } from 'react-native-image-picker';
import { pick, types as docTypes } from '@react-native-documents/picker';
import {
  normalizeMediaType,
  resolveMediaType,
} from '@mqtt-chat/mqtt-contracts';
import { api } from '../lib/api';
import { useChatSession, type Identity } from '../hooks/useChatSession';
import { IdentityPickerScreen } from '../screens/IdentityPickerScreen';
import { ConversationListScreen } from '../screens/ConversationListScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { NewConversationScreen } from '../screens/NewConversationScreen';
import { GroupDetailsScreen } from '../screens/GroupDetailsScreen';

type Route =
  | { screen: 'picker' }
  | { screen: 'list' }
  | { screen: 'new' }
  | { screen: 'details'; conversationId: string }
  | {
      screen: 'chat';
      conversationId: string;
      title: string;
      subtitle: string | null;
      isGroup: boolean;
    };

/** Peer-relative display title: A sees B's name and vice versa. */
function conversationTitle(
  conv:
    | {
        type: 'DIRECT' | 'GROUP';
        title: string | null;
        members: Array<{ userId: string }>;
      }
    | undefined,
  users: Awaited<ReturnType<typeof api.listUsers>>,
  identityUserId: string | null,
): string {
  if (!conv) return 'Direct chat';
  if (conv.type === 'GROUP') return conv.title ?? 'Group';
  const peerId = conv.members.find(m => m.userId !== identityUserId)?.userId;
  return (
    users.find(u => u.id === peerId)?.displayName ?? peerId ?? 'Direct chat'
  );
}

/**
 * Canonical media policy — ONE source of truth in @mqtt-chat/mqtt-contracts
 * (repair-log #26). Never raw-compares picker MIME: iOS reports JPEG as
 * `image/jpg`; Android may report no MIME at all (filename fallback).
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function AppRoot() {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.listUsers>>>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [route, setRoute] = useState<Route>({ screen: 'picker' });
  const [uploading, setUploading] = useState(false);
  const session = useChatSession(identity);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const us = await api.listUsers();
        if (!cancelled) setUsers(us);
      } catch (e) {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : 'failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const identityUser = users.find(u => u.id === identity?.userId) ?? null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#818cf8" />
      </View>
    );
  }
  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#f87171' }}>{loadError}</Text>
      </View>
    );
  }

  if (route.screen === 'picker' || !identity) {
    return (
      <IdentityPickerScreen
        users={users}
        onPick={userId => {
          setIdentity({
            userId,
            deviceId: `mobile-${Date.now().toString(36)}`,
          });
          setRoute({ screen: 'list' });
        }}
      />
    );
  }

  // ---- Attachment flows (binary via REST upload; MQTT carries metadata) ---
  const activeConversationId =
    route.screen === 'chat' || route.screen === 'details'
      ? route.conversationId
      : null;

  const handlePickedFile = async (
    file: { uri: string; name: string; type: string; size: number },
    kind: 'IMAGE' | 'FILE',
  ): Promise<void> => {
    const conversationId = activeConversationId;
    if (!conversationId || !identity) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      Alert.alert('File too large', 'Maximum upload size is 50 MB.');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await api.uploadFile(
        { uri: file.uri, name: file.name, type: file.type },
        conversationId,
      );
      // Optimistic media message through the SAME lifecycle (clientMessageId
      // first; canonical event reconciles it).
      await session.sendMediaMessage({
        conversationId,
        clientMessageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: kind,
        content: '',
        replyToId: null,
        metadata: {
          storageKey: uploaded.key,
          filename: uploaded.filename,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
        },
        pendingContent: `📎 ${uploaded.filename}`,
      });
    } catch (e) {
      Alert.alert(
        'Upload failed',
        e instanceof Error ? e.message : 'Unknown error',
        [{ text: 'OK' }],
      );
    } finally {
      setUploading(false);
    }
  };

  const pickImage = (): void => {
    void launchImageLibrary({ mediaType: 'photo', quality: 0.8 }).then(
      result => {
        const asset: Asset | undefined = result.assets?.[0];
        if (!asset?.uri) return; // user cancelled
        // Canonical normalization (repair-log #26): fold picker aliases
        // (image/jpg → image/jpeg), fall back to the filename extension when
        // the platform omits MIME, and give a PRECISE product error for
        // intentionally-unsupported formats (HEIC/HEIF).
        const resolved = resolveMediaType(asset.type, asset.fileName);
        const normalized = normalizeMediaType(asset.type);
        if (!resolved) {
          const isHeic =
            normalized === 'image/heic' ||
            normalized === 'image/heif' ||
            asset.fileName?.toLowerCase().endsWith('.heic') ||
            asset.fileName?.toLowerCase().endsWith('.heif');
          Alert.alert(
            'Unsupported image',
            isHeic
              ? 'HEIC/HEIF photos are not supported yet. Share the photo as JPEG instead.'
              : `Type ${normalized ?? 'unknown'} is not supported.`,
          );
          return;
        }
        if (!resolved.startsWith('image/')) {
          Alert.alert('Unsupported image', `${resolved} is not an image type.`);
          return;
        }
        void handlePickedFile(
          {
            uri: asset.uri,
            name:
              asset.fileName ??
              `photo-${Date.now()}.${resolved === 'image/png' ? 'png' : 'jpg'}`,
            type: resolved, // canonical value — never re-validated server-side
            size: asset.fileSize ?? 0,
          },
          'IMAGE',
        );
      },
    );
  };

  const pickDocument = (): void => {
    void pick({ type: [docTypes.pdf] })
      .then(results => {
        const doc = results[0];
        if (!doc?.uri) return;
        const name = doc.name ?? `document-${Date.now()}.pdf`;
        // Same canonical policy as images (repair-log #26): normalize the
        // platform MIME; fall back to the extension when absent.
        const resolved = resolveMediaType(doc.type, name) ?? 'application/pdf';
        void handlePickedFile(
          {
            uri: doc.uri,
            name,
            type: resolved,
            size: doc.size ?? 0,
          },
          'FILE',
        );
      })
      .catch(() => {
        /* user cancelled — not an error */
      });
  };

  if (route.screen === 'new') {
    return (
      <NewConversationScreen
        users={users}
        identityUserId={identity.userId}
        onBack={() => setRoute({ screen: 'list' })}
        onCreated={conversation => {
          // Optimistic upsert; the canonical conversation.created event also
          // arrives and collapses into the SAME entity (id upsert).
          session.upsertLocalConversation(conversation);
          setRoute({
            screen: 'chat',
            conversationId: conversation.id,
            title: conversationTitle(conversation, users, identity.userId),
            subtitle:
              conversation.type === 'GROUP'
                ? `${conversation.members.length} members`
                : null,
            isGroup: conversation.type === 'GROUP',
          });
        }}
      />
    );
  }

  if (route.screen === 'details') {
    const conversation = session.conversations.find(
      c => c.id === route.conversationId,
    );
    if (!conversation) {
      // Deleted under us (conversation.deleted) → leave the screen safely.
      setRoute({ screen: 'list' });
      return null;
    }
    return (
      <GroupDetailsScreen
        conversation={conversation}
        users={users}
        identityUserId={identity.userId}
        onBack={() => setRoute({ screen: 'list' })}
        onChanged={() => {
          void session.refreshConversations();
        }}
        onDeleted={() => setRoute({ screen: 'list' })}
      />
    );
  }

  if (route.screen === 'list') {
    return (
      <ConversationListScreen
        conversations={session.conversations}
        presence={session.presence}
        status={session.status}
        users={users}
        identityUserId={identity.userId}
        identityDisplayName={identityUser?.displayName ?? identity.userId}
        onOpen={conversationId => {
          const conv = session.conversations.find(c => c.id === conversationId);
          void session.openConversation(conversationId);
          setRoute({
            screen: 'chat',
            conversationId,
            title: conversationTitle(conv, users, identity.userId),
            subtitle:
              conv && conv.type === 'GROUP'
                ? `${conv.members?.length ?? 0} members`
                : null,
            isGroup: conv?.type === 'GROUP',
          });
        }}
        onNew={() => setRoute({ screen: 'new' })}
        // Profile switch: identity state change tears the whole session down
        // (useChatSession cleanup) and starts a fresh one on pick — §42.
        onProfile={() => {
          Alert.alert(
            identityUser?.displayName ?? identity.userId,
            identity.userId,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Switch profile',
                style: 'default',
                onPress: () => {
                  setIdentity(null);
                  setRoute({ screen: 'picker' });
                },
              },
            ],
          );
        }}
      />
    );
  }

  const activeConv = session.conversations.find(
    c => c.id === route.conversationId,
  );
  if (!activeConv) {
    // The open conversation was deleted in realtime (#28) — exit the chat
    // safely instead of rendering a ghost conversation.
    setRoute({ screen: 'list' });
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <ChatScreen
        title={route.title}
        subtitle={route.subtitle ?? undefined}
        messages={session.messagesByConv[route.conversationId] ?? []}
        pending={session.pendingListFor(route.conversationId)}
        typingUsers={session.typingByConv[route.conversationId] ?? []}
        identityUserId={identity.userId}
        isGroup={route.isGroup}
        hasMoreHistory={session.hasMoreByConv[route.conversationId] ?? false}
        loadingEarlier={
          session.loadingEarlierByConv[route.conversationId] ?? false
        }
        onLoadEarlier={() => {
          void session.loadOlderMessages(route.conversationId);
        }}
        actions={{
          send: (content, replyToId) => {
            void session.sendMessage(route.conversationId, content, replyToId);
          },
          edit: (messageId, content) => {
            void session.editMessage(route.conversationId, messageId, content);
          },
          delete: messageId => {
            void session.deleteMessage(route.conversationId, messageId);
          },
          react: (messageId, emoji, remove) => {
            session.toggleReaction(
              route.conversationId,
              messageId,
              emoji,
              remove,
            );
          },
          pickImage,
          pickDocument,
        }}
        onSend={(content, replyToId) => {
          void session.sendMessage(route.conversationId, content, replyToId);
        }}
        onRetry={cmid => {
          void session.retryMessage(cmid);
        }}
        onBack={() => setRoute({ screen: 'list' })}
        onTypingChange={isTyping =>
          session.sendTyping(route.conversationId, isTyping)
        }
        onOpenDetails={() =>
          setRoute({ screen: 'details', conversationId: route.conversationId })
        }
      />
      {uploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator color="#818cf8" />
          <Text style={styles.uploadText}>Uploading…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  uploadOverlay: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  uploadText: { color: '#cbd5e1', fontSize: 13 },
});
