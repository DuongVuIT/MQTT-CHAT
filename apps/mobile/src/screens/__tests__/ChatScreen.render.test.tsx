import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ChatScreen } from '../ChatScreen';
import { normalizeMessage } from '@mqtt-chat/realtime-core';
import type { ApiMessage } from '../../lib/api';

/**
 * Regression (PROJECT_STATUS MOBILE_REACTION_RENDER): a message reaching the
 * FlatList without a `reactions` field must NOT crash the screen. The raw
 * message.created event historically lacked `reactions`, producing
 * "Cannot read property 'length' of undefined".
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Minimal message WITHOUT the reactions field — exactly the legacy/realtime
// shape that crashed before normalization + defensive rendering.
const rawEventPayload = {
  messageId: 'm-crash',
  clientMessageId: 'c-crash',
  conversationId: 'conv1',
  senderId: 'user-a',
  senderType: 'USER',
  sequence: 1,
  type: 'TEXT',
  content: 'no reactions on the wire',
  createdAt: '2026-08-24T00:00:00.000Z',
};

const noopActions = {
  send: () => {},
  edit: () => {},
  delete: () => {},
  react: () => {},
  pickImage: () => {},
  pickDocument: () => {},
};

function render(messages: ApiMessage[]): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ChatScreen
        title="Regression"
        conversationId="conv1"
        peerInitials="R"
        messages={messages}
        pending={[]}
        typingUsers={[]}
        identityUserId="user-me"
        isGroup={false}
        actions={noopActions}
        onSend={() => {}}
        onRetry={() => {}}
        onBack={() => {}}
        onTypingChange={() => {}}
        onOpenDetails={() => {}}
      />,
    );
  });
  return tree;
}

describe('ChatScreen reaction rendering', () => {
  // The auto-scroll effect schedules a 50ms scrollToEnd — never fire it in
  // tests (RN's list mocks throw on programmatic scrolling).
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());

  it('renders a normalized message without reactions field — DOES NOT CRASH', () => {
    const normalized = normalizeMessage(
      rawEventPayload,
    ) as unknown as ApiMessage;
    expect(normalized.reactions).toEqual([]);
    expect(() => render([normalized])).not.toThrow();
  });

  it('renders a message whose reactions are literally undefined (legacy row)', () => {
    const legacy = {
      ...normalizeMessage(rawEventPayload),
      reactions: undefined,
    } as unknown as ApiMessage;
    expect(() => render([legacy])).not.toThrow();
  });

  it('renders reactions when present', () => {
    const msg = {
      ...normalizeMessage(rawEventPayload),
      reactions: [{ emoji: '👍', userId: 'user-b' }],
    } as unknown as ApiMessage;
    const tree = render([msg]);
    // toJSON() embeds React fibers (circular) — strip them before asserting.
    const rendered = JSON.stringify(tree.toJSON(), (_key, value) =>
      value && typeof value === 'object' && '_owner' in value
        ? undefined
        : value,
    );
    expect(rendered).toContain('👍');
  });
});
