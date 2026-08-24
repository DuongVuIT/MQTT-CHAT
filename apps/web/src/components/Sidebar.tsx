"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { Avatar } from "@mqtt-chat/ui";

/**
 * Sidebar v2 (§27): profile header (display name — never a raw userId),
 * search, new-conversation creation, and rows with avatar/presence/preview/
 * timestamp/unread badge. Skeleton rows while the roster loads (§66).
 */

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
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
  const identity = useChatStore((s) => s.identity);
  const users = useChatStore((s) => s.users);
  const conversations = useChatStore((s) => s.conversations);
  const presence = useChatStore((s) => s.presence);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversationsLoaded = useChatStore((s) => s.conversationsLoaded);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  // Identity is ALWAYS the runtime userId — display names are never identity.
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");

  // ONE conversationId = ONE entity: dedupe by id, order by recency.
  const sorted = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    return [...byId.values()].sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return tb - ta;
    });
  }, [conversations]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    const userById = new Map(users.map((u) => [u.id, u]));
    return sorted.filter((c) => {
      if (c.type === "GROUP") return (c.title ?? "group").toLowerCase().includes(q);
      const peerId = c.members?.find((m) => m.userId !== identity?.userId)?.userId;
      const name = userById.get(peerId ?? "")?.displayName ?? peerId ?? "";
      return name.toLowerCase().includes(q);
    });
  }, [sorted, filter, users, identity?.userId]);

  const toggleMember = (userId: string, on: boolean): void => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const createConversation = async (): Promise<void> => {
    if (!identity || selectedMembers.size === 0) return;
    try {
      const isGroup = selectedMembers.size > 1 || groupName.trim().length > 0;
      const res = await api.createConversation({
        type: isGroup ? "GROUP" : "DIRECT",
        title: isGroup ? groupName.trim() || undefined : undefined,
        createdBy: identity.userId,
        memberIds: [identity.userId, ...selectedMembers],
      });
      // Upsert (never prepend blindly): if the canonical conversation.created
      // realtime event already inserted this entity, we converge on ONE row.
      useChatStore.getState().upsertConversation(res.conversation);
      getRealtimeService().subscribeConversation(res.conversation.id);
      setActiveConversation(res.conversation.id);
      setCreating(false);
      setSelectedMembers(new Set());
      setUserFilter("");
      setGroupName("");
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to create conversation");
    }
  };

  const identityUser = users.find((u) => u.id === identity?.userId);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface">
      {/* Profile header (§27) — display name, not engineering ids. */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={identityUser?.displayName ?? identity?.userId ?? "?"} size="sm" />
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
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-3 transition-colors duration-fast hover:bg-raised hover:text-ink"
        >
          Switch
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
          placeholder="Search chats"
          aria-label="Search conversations"
          className="h-8 min-w-0 flex-1 rounded-lg bg-raised px-2.5 text-sm outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label={creating ? "Cancel new conversation" : "New conversation"}
          onClick={() => {
            setCreating((v) => !v);
            if (creating) {
              setSelectedMembers(new Set());
              setUserFilter("");
              setGroupName("");
            }
          }}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg font-medium transition-colors duration-fast ${
            creating
              ? "bg-raised text-ink hover:bg-high"
              : "bg-brand text-on-brand hover:bg-brand-strong"
          }`}
        >
          {creating ? "×" : "+"}
        </button>
      </div>

      {creating && (
        <div className="animate-sheet-in mx-3 mb-2 rounded-xl border border-line bg-app p-3">
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
                (u) =>
                  u.id !== identity?.userId &&
                  (userFilter.trim() === "" ||
                    u.displayName.toLowerCase().includes(userFilter.trim().toLowerCase())),
              )
              .map((u) => {
                const checked = selectedMembers.has(u.id);
                return (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-fast hover:bg-raised">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          toggleMember(u.id, e.target.checked);
                        }}
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      <span className="truncate">{u.displayName}</span>
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
        {conversationsLoaded && visible.length === 0 && (
          <li className="px-2 py-8 text-center">
            <p className="text-sm font-medium text-ink-2">No conversations yet</p>
            <p className="mt-1 text-xs text-ink-3">Start one with the + button above.</p>
          </li>
        )}
        {visible.map((c) => {
          // Defensive: a conversation payload missing `members` (e.g. a
          // stale/cached response) must degrade gracefully, not crash the
          // whole chat page. The API contract guarantees members, but the
          // UI must tolerate incomplete data.
          const members = c.members ?? [];
          const otherMember = members.find((m) => m.userId !== identity?.userId);
          const otherUser = users.find((u) => u.id === otherMember?.userId);
          const online = otherMember ? presence[otherMember.userId] : false;
          const isActive = c.id === activeConversationId;
          const isGroup = c.type === "GROUP";
          // Unread = canonical lastSequence − MY read watermark (§8).
          const myRead = members.find((m) => m.userId === identity?.userId)?.lastReadSequence ?? 0;
          const unread = Math.max(0, (c.lastSequence ?? 0) - myRead);
          const title = isGroup
            ? (c.title ?? "Group")
            : // Peer-relative label: A sees B, B sees A — never a generic
              // "Direct chat" when any peer info exists.
              (otherUser?.displayName ?? otherMember?.userId ?? "Direct chat");
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveConversation(c.id);
                }}
                aria-current={isActive}
                data-testid={`conversation-${c.id}`}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-fast ${
                  isActive ? "bg-brand-soft" : "hover:bg-raised"
                }`}
              >
                <Avatar name={title} size="md" online={isGroup ? undefined : online} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={`block truncate text-sm ${unread > 0 ? "font-semibold" : "font-medium"}`}
                    >
                      {title}
                    </span>
                    <span
                      className={`block shrink-0 text-[11px] ${
                        unread > 0 ? "font-semibold text-brand-strong" : "text-ink-3"
                      }`}
                    >
                      {timeLabel(c.lastMessageAt)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`block truncate text-xs ${
                        unread > 0 ? "font-medium text-ink" : "text-ink-3"
                      }`}
                    >
                      {c.lastMessagePreview ?? "No messages yet"}
                    </span>
                    {unread > 0 && (
                      <span
                        data-testid={`unread-${c.id}`}
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-on-brand"
                      >
                        {unread > 99 ? "99+" : unread}
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
