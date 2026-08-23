// Domain enums shared across apps and packages.
// Keep this package dependency-free: pure types + enums only.

export const ConversationType = {
  DIRECT: "DIRECT",
  GROUP: "GROUP",
} as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

export const MemberRole = {
  MEMBER: "MEMBER",
  ADMIN: "ADMIN",
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const SenderType = {
  USER: "USER",
  BOT: "BOT",
  SYSTEM: "SYSTEM",
} as const;
export type SenderType = (typeof SenderType)[keyof typeof SenderType];

export const MessageType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  FILE: "FILE",
  VOICE: "VOICE",
  SYSTEM: "SYSTEM",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ReceiptState = {
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
} as const;
export type ReceiptState = (typeof ReceiptState)[keyof typeof ReceiptState];

/** Demo users available in the identity picker (no auth by design). */
export const DEMO_USERS = ["duong", "alice", "bob", "john"] as const;
export type DemoUserId = (typeof DEMO_USERS)[number];

export interface UserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  title: string | null;
  memberCount: number;
  lastSequence: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

export interface MessageAttachmentMetadata {
  url: string;
  mimeType: string;
  size: number;
  filename: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnailUrl?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    requestId: string;
  };
}
