"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";

/**
 * Left sidebar: current user, conversation list with unread/preview,
 * new-conversation creation and switch-user.
 */

export function Sidebar() {
  const router = useRouter();
  const { identity, users, conversations, presence, activeConversationId, setActiveConversation } =
    useChatStore();
  const [creating, setCreating] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");

  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        return tb - ta;
      }),
    [conversations],
  );

  const createConversation = async (): Promise<void> => {
    if (!identity || selectedMembers.length === 0) return;
    try {
      const isGroup = selectedMembers.length > 1 || groupName.trim().length > 0;
      const res = await api.createConversation({
        type: isGroup ? "GROUP" : "DIRECT",
        title: isGroup ? groupName.trim() || undefined : undefined,
        createdBy: identity.userId,
        memberIds: [identity.userId, ...selectedMembers],
      });
      useChatStore.getState().setConversations([res.conversation, ...conversations]);
      getRealtimeService().subscribeConversation(res.conversation.id);
      setActiveConversation(res.conversation.id);
      setCreating(false);
      setSelectedMembers([]);
      setGroupName("");
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to create conversation");
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
            {identity?.userId.slice(0, 1).toUpperCase() ?? "?"}
          </span>
          <div>
            <p className="text-sm font-medium">{identity?.userId}</p>
            <p className="text-xs text-slate-400">{identity?.deviceId}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Switch user"
          onClick={() => {
            window.localStorage.removeItem("mqtt-chat-identity");
            router.push("/");
          }}
          className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
        >
          Switch
        </button>
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Conversations
        </h3>
        <button
          type="button"
          aria-label="New conversation"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
        >
          {creating ? "Cancel" : "+ New"}
        </button>
      </div>

      {creating && (
        <div className="mx-3 mb-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
            }}
            placeholder="Group name (optional)"
            className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <ul className="space-y-1">
            {users
              .filter((u) => u.id !== identity?.userId)
              .map((u) => (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(u.id)}
                      onChange={(e) => {
                        setSelectedMembers((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                        );
                      }}
                    />
                    {u.displayName}
                  </label>
                </li>
              ))}
          </ul>
          <button
            type="button"
            disabled={selectedMembers.length === 0}
            onClick={() => {
              void createConversation();
            }}
            className="mt-2 w-full rounded-lg bg-indigo-600 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto px-2 pb-4">
        {sorted.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-slate-400">No conversations yet</li>
        )}
        {sorted.map((c) => {
          // Defensive: a conversation payload missing `members` (e.g. a
          // stale/cached response) must degrade gracefully, not crash the
          // whole chat page. The API contract guarantees members, but the
          // UI must tolerate incomplete data.
          const members = c.members ?? [];
          const otherMember = members.find((m) => m.userId !== identity?.userId);
          const otherUser = users.find((u) => u.id === otherMember?.userId);
          const online = otherMember ? presence[otherMember.userId] : false;
          const isActive = c.id === activeConversationId;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveConversation(c.id);
                }}
                aria-current={isActive}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  isActive
                    ? "bg-indigo-50 dark:bg-slate-800"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 font-medium dark:bg-slate-700">
                  {(otherUser?.displayName ?? c.title ?? "#").slice(0, 1).toUpperCase()}
                  {online && (
                    <span
                      className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900"
                      aria-label="online"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {c.title ?? otherUser?.displayName ?? "Direct chat"}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {c.lastMessagePreview ?? "No messages yet"}
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
