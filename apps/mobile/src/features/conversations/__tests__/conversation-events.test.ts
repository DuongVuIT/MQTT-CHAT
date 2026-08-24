import {
  applyConversationEvent,
  applyMessageActivity,
  sortByActivity,
} from '../conversation-events';
import type { ApiConversation } from '../../../lib/api';

/**
 * Regression (P0 GROUP WEB -> MOBILE DISCOVERY): groups created on Web MUST
 * appear in the Mobile list in realtime, WITHOUT an app reload. The mobile
 * realtime handler previously had NO cases for conversation lifecycle
 * events, so canonical events were dropped on the floor.
 */

const conv = (
  id: string,
  over: Partial<ApiConversation> = {},
): ApiConversation => ({
  id,
  type: 'GROUP',
  title: id,
  memberCount: 1,
  lastSequence: 0,
  lastMessagePreview: null,
  lastMessageAt: null,
  members: [{ userId: 'user-me', role: 'MEMBER', lastReadSequence: 0 }],
  ...over,
});

const createdEvent = (id: string, members: string[] = ['user-me']) => ({
  eventType: 'conversation.created' as const,
  data: {
    id,
    type: 'GROUP',
    title: `group-${id}`,
    memberCount: members.length,
    lastSequence: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    members: members.map(userId => ({
      userId,
      role: 'MEMBER',
      lastReadSequence: 0,
    })),
  },
});

describe('applyConversationEvent — Web→Mobile discovery', () => {
  it('conversation.created for a member appears IMMEDIATELY (no reload)', () => {
    const next = applyConversationEvent(
      [],
      'conversation.created',
      createdEvent('g1').data,
      'user-me',
    );
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('g1');
    expect(next[0].title).toBe('group-g1');
  });

  it('conversation.created for a NON-member is ignored', () => {
    const next = applyConversationEvent(
      [conv('mine')],
      'conversation.created',
      createdEvent('theirs', ['user-a', 'user-b']).data,
      'user-me',
    );
    expect(next.map(c => c.id)).toEqual(['mine']);
  });

  it('duplicate created events collapse to ONE entity (QoS1 / REST+event race)', () => {
    let list: ApiConversation[] = [];
    list = applyConversationEvent(
      list,
      'conversation.created',
      createdEvent('g1').data,
      'user-me',
    );
    list = applyConversationEvent(
      list,
      'conversation.created',
      createdEvent('g1').data,
      'user-me',
    );
    expect(list).toHaveLength(1);
  });

  it('member-joined updates members and keeps local activity', () => {
    const existing = conv('g1', {
      lastSequence: 5,
      lastMessagePreview: 'hello',
      lastMessageAt: '2026-08-24T00:00:00.000Z',
    });
    const next = applyConversationEvent(
      [existing],
      'conversation.member-joined',
      {
        id: 'g1',
        type: 'GROUP',
        title: 'g1',
        memberCount: 2,
        lastSequence: 0,
        lastMessagePreview: null,
        lastMessageAt: null,
        members: [
          { userId: 'user-me', role: 'MEMBER', lastReadSequence: 0 },
          { userId: 'user-new', role: 'MEMBER', lastReadSequence: 0 },
        ],
      },
      'user-me',
    );
    expect(next[0].members.map(m => m.userId)).toEqual(['user-me', 'user-new']);
    expect(next[0].lastSequence).toBe(5);
    expect(next[0].lastMessagePreview).toBe('hello');
  });

  it('member-left removes the entity when I am the one removed', () => {
    const next = applyConversationEvent(
      [conv('g1'), conv('g2')],
      'conversation.member-left',
      { id: 'g1', removedUserId: 'user-me', members: [] },
      'user-me',
    );
    expect(next.map(c => c.id)).toEqual(['g2']);
  });

  it('member-left of someone else keeps the entity with updated members', () => {
    const withPeer = conv('g1', {
      members: [
        { userId: 'user-me', role: 'MEMBER', lastReadSequence: 0 },
        { userId: 'user-peer', role: 'MEMBER', lastReadSequence: 0 },
      ],
    });
    const next = applyConversationEvent(
      [withPeer],
      'conversation.member-left',
      {
        id: 'g1',
        removedUserId: 'user-peer',
        members: [{ userId: 'user-me', role: 'MEMBER', lastReadSequence: 0 }],
      },
      'user-me',
    );
    expect(next).toHaveLength(1);
    expect(next[0].members.map(m => m.userId)).toEqual(['user-me']);
  });
});

describe('applyMessageActivity — list reacts to new messages', () => {
  it('advances summary monotonic and re-sorts by activity', () => {
    const older = conv('older', {
      lastSequence: 3,
      lastMessagePreview: 'old',
      lastMessageAt: '2026-08-23T00:00:00.000Z',
    });
    const active = conv('active', {
      lastSequence: 9,
      lastMessagePreview: 'newer',
      lastMessageAt: '2026-08-24T00:00:00.000Z',
    });
    const next = applyMessageActivity([older, active], {
      conversationId: 'older',
      sequence: 4,
      preview: 'fresh message',
      at: '2026-08-24T06:00:00.000Z',
    });
    expect(next[0].id).toBe('older'); // re-sorted to top
    expect(next[0].lastSequence).toBe(4);
    expect(next[0].lastMessagePreview).toBe('fresh message');
  });

  it('never regresses lastSequence (out-of-order / duplicate delivery)', () => {
    const c = conv('g1', { lastSequence: 10 });
    const next = applyMessageActivity([c], {
      conversationId: 'g1',
      sequence: 4,
      preview: 'stale',
      at: '2026-08-24T06:00:00.000Z',
    });
    expect(next[0].lastSequence).toBe(10);
  });

  it('sortByActivity puts conversations without messages last', () => {
    const sorted = sortByActivity([
      conv('no-messages'),
      conv('recent', { lastMessageAt: '2026-08-24T00:00:00.000Z' }),
    ]);
    expect(sorted.map(c => c.id)).toEqual(['recent', 'no-messages']);
  });
});
