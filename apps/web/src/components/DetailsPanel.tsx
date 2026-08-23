"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ApiConversation } from "@/lib/api";
import { useChatStore } from "@/store/chat-store";

/**
 * Right details panel (collapsible): members with presence, conversation info,
 * and add-member for groups (canonical member-joined event reconciles every
 * client without reload).
 */

export function DetailsPanel({ conversation }: { conversation: ApiConversation | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const users = useChatStore((s) => s.users);
  const presence = useChatStore((s) => s.presence);

  if (!conversation) return null;

  const nonMembers = users.filter(
    (u) => u.id !== undefined && !(conversation.members ?? []).some((m) => m.userId === u.id),
  );

  const addMember = async (userId: string): Promise<void> => {
    if (!conversation || addBusy) return;
    setAddBusy(true);
    try {
      await api.addMembers(conversation.id, [userId]);
      // The canonical conversation.member-joined event updates this panel;
      // optimistic close keeps the flow snappy even if the event lags.
      setAddingMember(false);
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to add member");
    } finally {
      setAddBusy(false);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Show details"
        onClick={() => {
          setCollapsed(false);
        }}
        className="w-10 shrink-0 border-l border-slate-200 text-slate-400 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
      >
        ‹
      </button>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold">Details</h3>
        <button
          type="button"
          aria-label="Hide details"
          onClick={() => {
            setCollapsed(true);
          }}
          className="rounded px-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          ›
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Type</dt>
            <dd>{conversation.type}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Last sequence</dt>
            <dd>{conversation.lastSequence}</dd>
          </div>
        </dl>

        <h4 className="mt-6 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>
            Members ({(conversation.members ?? []).length}
            {conversation.memberCount > (conversation.members ?? []).length
              ? ` of ${conversation.memberCount}`
              : ""}
            )
          </span>
          {conversation.type === "GROUP" && (
            <button
              type="button"
              aria-label="Add member"
              onClick={() => {
                setAddingMember((v) => !v);
              }}
              className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-medium normal-case text-white hover:bg-indigo-500"
            >
              + Add
            </button>
          )}
        </h4>

        {addingMember && (
          <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            {nonMembers.length === 0 && (
              <li className="text-xs text-slate-400">Everyone is already a member</li>
            )}
            {nonMembers.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={addBusy}
                  onClick={() => {
                    void addMember(u.id);
                  }}
                  className="w-full truncate rounded px-1.5 py-1 text-left text-sm hover:bg-indigo-50 disabled:opacity-50 dark:hover:bg-slate-800"
                >
                  {u.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-2 space-y-1.5">
          {/* Defensive: tolerate an incomplete conversation payload (missing
              members) instead of crashing the whole chat page. */}
          {(conversation.members ?? []).map((m) => {
            const user = users.find((u) => u.id === m.userId);
            // Presence is tri-state: true=online, false=offline (server
            // confirmed), undefined=unknown (snapshot not yet resolved).
            const state = presence[m.userId];
            const dotClass =
              state === true
                ? "bg-emerald-500"
                : state === false
                  ? "bg-slate-300 dark:bg-slate-600"
                  : "border border-slate-400 dark:border-slate-500";
            return (
              <li key={m.userId} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${dotClass}`}
                  aria-label={state === true ? "online" : state === false ? "offline" : "unknown"}
                />
                <span className="truncate">{user?.displayName ?? m.userId}</span>
                {m.role === "ADMIN" && (
                  <span className="ml-auto rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    ADMIN
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
