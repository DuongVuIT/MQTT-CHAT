import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useChatSession, type Identity } from '../hooks/useChatSession';
import { IdentityPickerScreen } from '../screens/IdentityPickerScreen';
import { ConversationListScreen } from '../screens/ConversationListScreen';
import { ChatScreen } from '../screens/ChatScreen';

type Route =
  | { screen: 'picker' }
  | { screen: 'list' }
  | {
      screen: 'chat';
      conversationId: string;
      title: string;
      subtitle: string | null;
    };

/** Peer-relative display title: A sees B's name and vice versa. */
function conversationTitle(
  conv: ReturnType<typeof useChatSession>['conversations'][number] | undefined,
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

export function AppRoot() {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.listUsers>>>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [route, setRoute] = useState<Route>({ screen: 'picker' });
  const session = useChatSession(identity);

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

  if (route.screen === 'picker') {
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

  if (route.screen === 'list') {
    return (
      <ConversationListScreen
        conversations={session.conversations}
        presence={session.presence}
        status={session.status}
        users={users}
        identityUserId={identity?.userId ?? null}
        onOpen={conversationId => {
          const conv = session.conversations.find(c => c.id === conversationId);
          void session.openConversation(conversationId);
          setRoute({
            screen: 'chat',
            conversationId,
            title: conversationTitle(conv, users, identity?.userId ?? null),
            subtitle:
              conv && conv.type === 'GROUP'
                ? `${conv.members?.length ?? 0} members`
                : null,
          });
        }}
      />
    );
  }

  return (
    <ChatScreen
      title={route.title}
      subtitle={route.subtitle ?? undefined}
      messages={session.messagesByConv[route.conversationId] ?? []}
      pending={session.pendingListFor(route.conversationId)}
      typingUsers={session.typingByConv[route.conversationId] ?? []}
      identityUserId={identity?.userId ?? null}
      onSend={content => {
        void session.sendMessage(route.conversationId, content);
      }}
      onRetry={cmid => {
        void session.retryMessage(cmid);
      }}
      onBack={() => setRoute({ screen: 'list' })}
      onTypingChange={isTyping =>
        session.sendTyping(route.conversationId, isTyping)
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
});
