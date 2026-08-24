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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const users = useChatStore((s) => s.users);
  const presence = useChatStore((s) => s.presence);
  const identity = useChatStore((s) => s.identity);
  // Member removal (#35/#37): admin removes others; any member can leave.
  // Hooks BEFORE the early return — unconditional order.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  if (!conversation) return null;

  // Permission model (#38): only a member with role ADMIN (the creator) may
  // delete the group — derived from the immutable member role, not labels.
  const isAdmin =
    identity !== null &&
    (conversation.members ?? []).some((m) => m.userId === identity.userId && m.role === "ADMIN");

  // Member removal (#35/#37) — state declared above the early return.
  const removeMember = async (userId: string): Promise<void> => {
    if (!conversation || !identity || removeBusy) return;
    setRemoveBusy(true);
    try {
      await api.removeMember(conversation.id, userId, identity.userId);
      setConfirmingRemove(null);
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to remove member");
    } finally {
      setRemoveBusy(false);
    }
  };

  const deleteGroup = async (): Promise<void> => {
    if (!conversation || deleteBusy || !identity) return;
    setDeleteBusy(true);
    try {
      await api.deleteGroup(conversation.id, identity.userId);
      // Canonical conversation.deleted event clears list/chat/pendings.
      setConfirmingDelete(false);
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to delete group");
    } finally {
      setDeleteBusy(false);
    }
  };

  const nonMembers = users.filter(
    (u) => u.id !== undefined && !(conversation.members ?? []).some((m) => m.userId === u.id),
  );

  const addMember = async (userId: string): Promise<void> => {
    if (!conversation || addBusy) return;
    setAddBusy(true);
    try {
      await api.addMembers(conversation.id, [userId], identity!.userId);
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
            const isSelf = m.userId === identity?.userId;
            const canRemove = conversation.type === "GROUP" && (isAdmin ? !isSelf : isSelf); // admin removes others; anyone leaves self (#37/#38)
            return (
              <li key={m.userId} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${dotClass}`}
                  aria-label={state === true ? "online" : state === false ? "offline" : "unknown"}
                />
                <span className="truncate">{isSelf ? "You" : (user?.displayName ?? m.userId)}</span>
                {/* Remove/Leave with inline two-step confirm (#35/#38). */}
                {canRemove &&
                  (confirmingRemove === m.userId ? (
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Confirm remove ${user?.displayName ?? m.userId}`}
                        data-testid={`confirm-remove-${m.userId}`}
                        disabled={removeBusy}
                        onClick={() => {
                          void removeMember(m.userId);
                        }}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel remove"
                        onClick={() => {
                          setConfirmingRemove(null);
                        }}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] dark:border-slate-600"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={
                        isSelf ? "Leave group" : `Remove ${user?.displayName ?? m.userId}`
                      }
                      data-testid={`remove-member-${m.userId}`}
                      onClick={() => {
                        setConfirmingRemove(m.userId);
                      }}
                      className={`${m.role === "ADMIN" ? "" : "ml-auto"} rounded px-1 text-[10px] text-red-400 hover:text-red-600`}
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </button>
                  ))}
                {m.role === "ADMIN" && (
                  <span
                    className={`${canRemove || confirmingRemove === m.userId ? "" : "ml-auto"} rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/50 dark:text-amber-300`}
                  >
                    ADMIN
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Danger Zone (#14): group lifecycle ender — two-step destructive
            confirmation, admin-only. The canonical conversation.deleted
            event removes the group everywhere without reload. */}
        {conversation.type === "GROUP" && isAdmin && (
          <div className="mt-8 rounded-lg border border-red-200 p-3 dark:border-red-900/60">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
              Danger zone
            </p>
            {!confirmingDelete ? (
              <button
                type="button"
                data-testid="delete-group"
                disabled={deleteBusy}
                onClick={() => {
                  setConfirmingDelete(true);
                }}
                className="mt-2 w-full rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                Delete Group
              </button>
            ) : (
              <div className="mt-2" data-testid="delete-group-confirm">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Delete "{conversation.title ?? "Group"}"? This group will be removed for all
                  members.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="delete-group-confirm-button"
                    disabled={deleteBusy}
                    onClick={() => {
                      void deleteGroup();
                    }}
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
