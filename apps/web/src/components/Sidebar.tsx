"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloseIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { Avatar } from "@mqtt-chat/ui";

/**
 * Sidebar v2 (§27): profile header (display name — never a raw userId),
 * search, new-conversation creation, and rows with avatar/presence/preview/
 * timestamp/unread badge. Skeleton rows while the roster loads (§66).
 */

function timeLabel(timestamp: string | null | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SidebarSkeleton(): React.JSX.Element {
  return (
    <li className="px-2 py-2" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="animate-skeleton h-10 w-10 rounded-full bg-raised" />
        <div className="flex-1 space-y-1.5">
          <div className="animate-skeleton h-3.5 w-2/5 rounded bg-raised" />
          <div className="animate-skeleton h-3 w-3/5 rounded bg-raised" />
        </div>
      </div>
    </li>
  );
}

export function Sidebar() {
  const router = useRouter();
  // PERF: slice subscriptions — the whole-store destructure re-rendered the
  // sidebar on EVERY store mutation (typing, receipts, message arrays…).
  // Actions are stable and never trigger renders.
  const identity = useChatStore((state) => state.identity);
  const users = useChatStore((state) => state.users);
  const conversations = useChatStore((state) => state.conversations);
  const presence = useChatStore((state) => state.presence);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversationsLoaded = useChatStore((state) => state.conversationsLoaded);
  const setActiveConversation = useChatStore((state) => state.setActiveConversation);
  const [isCreating, setIsCreating] = useState(false);
  const [conversationFilter, setConversationFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  // Identity is ALWAYS the runtime userId — display names are never identity.
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");

  // ONE conversationId = ONE entity: dedupe by id, order by recency.
  const sortedConversations = useMemo(() => {
    const conversationsById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    return [...conversationsById.values()].sort((firstConversation, secondConversation) => {
      const firstTimestamp = firstConversation.lastMessageAt
        ? Date.parse(firstConversation.lastMessageAt)
        : 0;
      const secondTimestamp = secondConversation.lastMessageAt
        ? Date.parse(secondConversation.lastMessageAt)
        : 0;
      return secondTimestamp - firstTimestamp;
    });
  }, [conversations]);

  const visibleConversations = useMemo(() => {
    const normalizedFilter = conversationFilter.trim().toLowerCase();
    if (!normalizedFilter) return sortedConversations;
    const usersById = new Map(users.map((user) => [user.id, user]));
    return sortedConversations.filter((conversation) => {
      if (conversation.type === "GROUP") {
        return (conversation.title ?? "group").toLowerCase().includes(normalizedFilter);
      }
      const peerId = conversation.members?.find(
        (member) => member.userId !== identity?.userId,
      )?.userId;
      const displayName = usersById.get(peerId ?? "")?.displayName ?? peerId ?? "";
      return displayName.toLowerCase().includes(normalizedFilter);
    });
  }, [sortedConversations, conversationFilter, users, identity?.userId]);

  const toggleMember = (userId: string, on: boolean): void => {
    setSelectedMembers((previousMembers) => {
      const nextMembers = new Set(previousMembers);
      if (on) nextMembers.add(userId);
      else nextMembers.delete(userId);
      return nextMembers;
    });
  };

  const createConversation = async (): Promise<void> => {
    if (!identity || selectedMembers.size === 0) return;
    try {
      const isGroup = selectedMembers.size > 1 || groupName.trim().length > 0;
      const response = await api.createConversation({
        type: isGroup ? "GROUP" : "DIRECT",
        title: isGroup ? groupName.trim() || undefined : undefined,
        createdBy: identity.userId,
        memberIds: [identity.userId, ...selectedMembers],
      });
      // Upsert (never prepend blindly): if the canonical conversation.created
      // realtime event already inserted this entity, we converge on ONE row.
      useChatStore.getState().upsertConversation(response.conversation);
      getRealtimeService().subscribeConversation(response.conversation.id);
      setActiveConversation(response.conversation.id);
      setIsCreating(false);
      setSelectedMembers(new Set());
      setUserFilter("");
      setGroupName("");
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to create conversation");
    }
  };

  const identityUser = users.find((user) => user.id === identity?.userId);

  return (
    <aside className="glass-surface flex w-80 shrink-0 flex-col border-r border-line">
      {/* Profile header (§27) — display name, not engineering ids. */}
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar
            name={identityUser?.displayName ?? identity?.userId ?? "?"}
            colorKey={identity?.userId ?? "?"}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {identityUser?.displayName ?? identity?.userId}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Switch user"
          onClick={() => {
            window.localStorage.removeItem("mqtt-chat-identity");
            router.push("/");
          }}
          className="rounded-lg px-2.5 py-2 text-xs font-medium text-ink-2 transition-colors duration-fast hover:bg-raised hover:text-ink"
        >
          Switch
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pb-3 pt-4">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-raised/70 px-3 transition-colors focus-within:border-brand/60">
          <SearchIcon className="h-4 w-4 shrink-0 text-ink-3" />
          <input
            value={conversationFilter}
            onChange={(e) => {
              setConversationFilter(e.target.value);
            }}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </label>
        <button
          type="button"
          aria-label={isCreating ? "Cancel new conversation" : "New conversation"}
          onClick={() => {
            setIsCreating((currentValue) => !currentValue);
            if (isCreating) {
              setSelectedMembers(new Set());
              setUserFilter("");
              setGroupName("");
            }
          }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg font-medium transition-colors duration-fast ${
            isCreating
              ? "bg-raised text-ink hover:bg-high"
              : "border-brand bg-brand text-on-brand shadow-floating hover:bg-brand-strong"
          }`}
        >
          {isCreating ? <CloseIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
        </button>
      </div>

      {isCreating && (
        <div className="animate-sheet-in elevated-surface mx-3 mb-3 rounded-2xl border border-line-strong p-3">
          <input
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
            }}
            placeholder="Group name (optional)"
            aria-label="Group name"
            className="mb-2 w-full rounded-lg bg-raised px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-3"
          />
          <input
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
            }}
            placeholder="Search people…"
            aria-label="Search users"
            className="mb-2 w-full rounded-lg bg-raised px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-3"
          />
          <ul className="max-h-48 space-y-0.5 overflow-y-auto" aria-label="Selectable users">
            {users
              .filter(
                (user) =>
                  user.id !== identity?.userId &&
                  (userFilter.trim() === "" ||
                    user.displayName.toLowerCase().includes(userFilter.trim().toLowerCase())),
              )
              .map((user) => {
                const isSelected = selectedMembers.has(user.id);
                return (
                  <li key={user.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-fast hover:bg-raised">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          toggleMember(user.id, e.target.checked);
                        }}
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      <span className="truncate">{user.displayName}</span>
                    </label>
                  </li>
                );
              })}
          </ul>
          <button
            type="button"
            disabled={selectedMembers.size === 0}
            onClick={() => {
              void createConversation();
            }}
            className="mt-2 w-full rounded-lg bg-brand py-1.5 text-sm font-medium text-on-brand transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
          >
            {selectedMembers.size > 1 || groupName.trim()
              ? `Create group · ${selectedMembers.size + 1}`
              : `Chat with ${selectedMembers.size || "…"}`}
          </button>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversations">
        {!conversationsLoaded && (
          <>
            <SidebarSkeleton />
            <SidebarSkeleton />
            <SidebarSkeleton />
            <SidebarSkeleton />
          </>
        )}
        {conversationsLoaded && visibleConversations.length === 0 && (
          <li className="px-2 py-8 text-center">
            <p className="text-sm font-medium text-ink-2">No conversations yet</p>
            <p className="mt-1 text-xs text-ink-3">Start one with the + button above.</p>
          </li>
        )}
        {visibleConversations.map((conversation) => {
          // Defensive: a conversation payload missing `members` (e.g. a
          // stale/cached response) must degrade gracefully, not crash the
          // whole chat page. The API contract guarantees members, but the
          // UI must tolerate incomplete data.
          const members = conversation.members ?? [];
          const otherMember = members.find((member) => member.userId !== identity?.userId);
          const otherUser = users.find((user) => user.id === otherMember?.userId);
          const online = otherMember ? presence[otherMember.userId] : false;
          const isActive = conversation.id === activeConversationId;
          const isGroup = conversation.type === "GROUP";
          // Unread = canonical lastSequence − MY read watermark (§8).
          const lastReadSequence =
            members.find((member) => member.userId === identity?.userId)?.lastReadSequence ?? 0;
          const unreadCount = Math.max(0, (conversation.lastSequence ?? 0) - lastReadSequence);
          const title = isGroup
            ? (conversation.title ?? "Group")
            : // Peer-relative label: A sees B, B sees A — never a generic
              // "Direct chat" when any peer info exists.
              (otherUser?.displayName ?? otherMember?.userId ?? "Direct chat");
          return (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveConversation(conversation.id);
                }}
                aria-current={isActive}
                data-testid={`conversation-${conversation.id}`}
                className={`flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-fast ${
                  isActive
                    ? "border border-brand/30 bg-brand-soft"
                    : "border border-transparent hover:bg-raised"
                }`}
              >
                <Avatar
                  name={title}
                  colorKey={isGroup ? conversation.id : (otherMember?.userId ?? conversation.id)}
                  size="md"
                  online={isGroup ? undefined : online}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={`block truncate text-sm ${unreadCount > 0 ? "font-semibold" : "font-medium"}`}
                    >
                      {title}
                    </span>
                    <span
                      className={`block shrink-0 text-[11px] ${
                        unreadCount > 0 ? "font-semibold text-brand-strong" : "text-ink-3"
                      }`}
                    >
                      {timeLabel(conversation.lastMessageAt)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`block truncate text-xs ${
                        unreadCount > 0 ? "font-medium text-ink" : "text-ink-3"
                      }`}
                    >
                      {conversation.lastMessagePreview ?? "No messages yet"}
                    </span>
                    {unreadCount > 0 && (
                      <span
                        data-testid={`unread-${conversation.id}`}
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-on-brand"
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
