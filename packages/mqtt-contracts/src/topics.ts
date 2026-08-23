/**
 * Canonical MQTT topic namespace and builders.
 * NEVER hardcode topics in applications — always use these builders/constants.
 */

export const TOPIC_NAMESPACE = "chat/v1" as const;

/** Command topics — a client/system REQUESTS something. */
export const COMMAND_TOPICS = {
  messageSend: `${TOPIC_NAMESPACE}/commands/message/send`,
  messageEdit: `${TOPIC_NAMESPACE}/commands/message/edit`,
  messageDelete: `${TOPIC_NAMESPACE}/commands/message/delete`,
  reactionAdd: `${TOPIC_NAMESPACE}/commands/reaction/add`,
  reactionRemove: `${TOPIC_NAMESPACE}/commands/reaction/remove`,
  receiptRead: `${TOPIC_NAMESPACE}/commands/receipt/read`,
  receiptDelivered: `${TOPIC_NAMESPACE}/commands/receipt/delivered`,
  typingSet: `${TOPIC_NAMESPACE}/commands/typing/set`,
  presenceSet: `${TOPIC_NAMESPACE}/commands/presence/set`,
  botSend: `${TOPIC_NAMESPACE}/commands/bot/send`,
} as const;
export type CommandTopicKey = keyof typeof COMMAND_TOPICS;

/** Event topics — the system ANNOUNCES something that already happened. */
export const EVENT_TOPICS = {
  messageCreated: `${TOPIC_NAMESPACE}/events/message/created`,
  messageEdited: `${TOPIC_NAMESPACE}/events/message/edited`,
  messageDeleted: `${TOPIC_NAMESPACE}/events/message/deleted`,
  reactionAdded: `${TOPIC_NAMESPACE}/events/reaction/added`,
  reactionRemoved: `${TOPIC_NAMESPACE}/events/reaction/removed`,
  receiptDelivered: `${TOPIC_NAMESPACE}/events/receipt/delivered`,
  receiptRead: `${TOPIC_NAMESPACE}/events/receipt/read`,
  typingStarted: `${TOPIC_NAMESPACE}/events/typing/started`,
  typingStopped: `${TOPIC_NAMESPACE}/events/typing/stopped`,
  presenceOnline: `${TOPIC_NAMESPACE}/events/presence/online`,
  presenceOffline: `${TOPIC_NAMESPACE}/events/presence/offline`,
  conversationCreated: `${TOPIC_NAMESPACE}/events/conversation/created`,
  conversationUpdated: `${TOPIC_NAMESPACE}/events/conversation/updated`,
  conversationMemberJoined: `${TOPIC_NAMESPACE}/events/conversation/member-joined`,
  conversationMemberLeft: `${TOPIC_NAMESPACE}/events/conversation/member-left`,
  mediaUploaded: `${TOPIC_NAMESPACE}/events/media/uploaded`,
  systemError: `${TOPIC_NAMESPACE}/events/system/error`,
} as const;
export type EventTopicKey = keyof typeof EVENT_TOPICS;

/**
 * Per-user event topic for targeted delivery (e.g. receipts, notifications).
 * Example: chat/v1/users/{userId}/events/receipt/read
 */
export function userEventTopic(
  userId: string,
  event: "receipt/read" | "receipt/delivered",
): string {
  return `${TOPIC_NAMESPACE}/users/${encodeURIComponent(userId)}/events/${event}`;
}

/**
 * Wildcard matching every event published on a user's per-user event topics
 * (see {@link userEventTopic}). Used by clients that must observe all events
 * targeted at them without knowing each concrete event type up front.
 * Example: chat/v1/users/{userId}/events/#
 */
export function userEventsWildcardTopic(userId: string): string {
  return `${TOPIC_NAMESPACE}/users/${encodeURIComponent(userId)}/events/#`;
}

/**
 * Per-conversation event topic for conversation-scoped fan-out.
 * Example: chat/v1/conversations/{conversationId}/events/message/created
 */
export function conversationEventTopic(conversationId: string, suffix: string): string {
  return `${TOPIC_NAMESPACE}/conversations/${encodeURIComponent(conversationId)}/events/${suffix}`;
}

/**
 * Non-canonical bot observability channel (publish_event action).
 * Example: chat/v1/bots/{botId}/events
 */
export function botEventsTopic(botId: string): string {
  return `${TOPIC_NAMESPACE}/bots/${encodeURIComponent(botId)}/events`;
}

/** Wildcards used by workers (shared subscriptions keep them scalable). */
export const SUBSCRIPTION_PATTERNS = {
  /** All commands — consumed by chat-worker group. */
  allCommands: `${TOPIC_NAMESPACE}/commands/#`,
  /** All events — consumed by bot-worker / admin observer groups. */
  allEvents: `${TOPIC_NAMESPACE}/events/#`,
  /** Message created only — notification worker group. */
  messageCreated: EVENT_TOPICS.messageCreated,
} as const;

/** Shared subscription helper: distributes messages across instances of a group. */
export function sharedSubscription(group: string, pattern: string): string {
  return `$share/${group}/${pattern}`;
}
