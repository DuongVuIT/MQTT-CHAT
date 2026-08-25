"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ApiConversation } from "@/lib/api";
import { useChatStore } from "@/store/chat-store";
import { Avatar } from "@mqtt-chat/ui";

/**
 * Details panel v2 (§33): group identity block, Members section with real
 * avatars + roles + consistent per-row actions, add-member, and a quiet
 * danger zone. No raw enums or sequence numbers — that's debug data.
 * Collapses to a rail on desktop; the page renders it as a drawer on narrow
 * viewports (§26).
 */

export function DetailsPanel({
  conversation,
  onClose,
}: {
  conversation: ApiConversation | null;
  /** Drawer close (narrow viewports); omitted on desktop rail mode. */
  onClose?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const users = useChatStore((s) => s.users);
  const presence = useChatStore((s) => s.presence);
  const identity = useChatStore((s) => s.identity);
  // Member removal (#35/#37): admin removes others; any member can leave.
  // Hooks BEFORE the early return — unconditional order.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Show details"
        onClick={() => {
          setCollapsed(false);
        }}
        className="w-10 shrink-0 border-l border-line text-ink-3 transition-colors duration-fast hover:bg-raised"
      >
        ‹
      </button>
    );
  }

  if (!conversation) {
    // Empty state (§28/§33) — never a blank white strip.
    return (
      <aside className="hidden w-72 shrink-0 flex-col border-l border-line bg-surface lg:flex">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">Details</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span aria-hidden className="text-3xl">
            ℹ️
          </span>
          <p className="mt-2 text-sm font-medium text-ink-2">No conversation selected</p>
          <p className="mt-1 text-xs text-ink-3">
            Open a chat to see its members and actions here.
          </p>
        </div>
      </aside>
    );
  }

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

  const members = conversation.members ?? [];
  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers = users.filter(
    (u) =>
      !memberIds.has(u.id) &&
      (memberFilter.trim() === "" ||
        u.displayName.toLowerCase().includes(memberFilter.trim().toLowerCase())),
  );

  const addMember = async (userId: string): Promise<void> => {
    if (!conversation || addBusy) return;
    setAddBusy(true);
    try {
      await api.addMembers(conversation.id, [userId], identity!.userId);
      // The canonical conversation.member-joined event updates this panel;
      // optimistic close keeps the flow snappy even if the event lags.
      setAddingMember(false);
      setMemberFilter("");
    } catch (error) {
      useChatStore
        .getState()
        .setError(error instanceof Error ? error.message : "Failed to add member");
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold">Details</h3>
        <div className="flex items-center gap-1">
          {onClose ? (
            <button
              type="button"
              aria-label="Close details"
              onClick={onClose}
              className="rounded px-1.5 text-ink-3 hover:bg-raised hover:text-ink lg:hidden"
            >
              ✕
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Hide details"
            onClick={() => {
              setCollapsed(true);
            }}
            className="hidden rounded px-1.5 text-ink-3 hover:bg-raised hover:text-ink lg:block"
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Identity block (§22/§33) */}
        <div className="flex flex-col items-center pb-4 text-center">
          <Avatar
            name={conversation.type === "GROUP" ? (conversation.title ?? "Group") : "Direct"}
            colorKey={conversation.id}
            size="lg"
          />
          <p className="mt-2 max-w-full truncate text-sm font-semibold">
            {conversation.type === "GROUP"
              ? (conversation.title ?? "Group")
              : (() => {
                  const peer = members.find((m) => m.userId !== identity?.userId);
                  return (
                    users.find((u) => u.id === peer?.userId)?.displayName ??
                    peer?.userId ??
                    "Direct chat"
                  );
                })()}
          </p>
          <p className="text-xs text-ink-3">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Members · {members.length}
          </h4>
          {conversation.type === "GROUP" && isAdmin && (
            // Permission model (#38): only an ADMIN may add members — hide
            // the affordance for everyone else instead of inviting a 403.
            <button
              type="button"
              aria-label="Add member"
              data-testid="add-member-toggle"
              onClick={() => {
                setAddingMember((v) => !v);
                if (addingMember) setMemberFilter("");
              }}
              className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-semibold text-on-brand transition-colors duration-fast hover:bg-brand-strong"
            >
              {addingMember ? "Close" : "+ Add"}
            </button>
          )}
        </div>

        {addingMember && (
          <div className="animate-sheet-in mt-2 rounded-lg border border-line p-2">
            <input
              value={memberFilter}
              onChange={(e) => {
                setMemberFilter(e.target.value);
              }}
              placeholder="Search people…"
              aria-label="Search people to add"
              className="mb-1.5 w-full rounded-md bg-raised px-2 py-1 text-sm outline-none placeholder:text-ink-3"
            />
            <ul className="max-h-44 space-y-0.5 overflow-y-auto">
              {nonMembers.length === 0 && (
                <li className="px-1.5 py-1 text-xs text-ink-3">Everyone is already here</li>
              )}
              {nonMembers.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={addBusy}
                    onClick={() => {
                      void addMember(u.id);
                    }}
                    className="flex w-full items-center gap-2 truncate rounded-md px-1.5 py-1 text-left text-sm transition-colors duration-fast hover:bg-raised disabled:opacity-50"
                  >
                    <Avatar name={u.displayName} colorKey={u.id} size="sm" />
                    <span className="truncate">{u.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="mt-2 space-y-0.5">
          {/* Defensive: tolerate an incomplete conversation payload (missing
              members) instead of crashing the whole chat page. */}
          {members.map((m) => {
            const user = users.find((u) => u.id === m.userId);
            const isSelf = m.userId === identity?.userId;
            const display = isSelf ? "You" : (user?.displayName ?? "Member");
            const canRemove = conversation.type === "GROUP" && (isAdmin ? !isSelf : isSelf); // admin removes others; anyone leaves self (#37/#38)
            return (
              <li
                key={m.userId}
                className="flex min-h-10 items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm"
              >
                {/* Avatar hashes the REAL name (never the "You" label) so a
                    member's color matches everywhere. */}
                <Avatar
                  name={user?.displayName ?? m.userId}
                  colorKey={m.userId}
                  size="sm"
                  online={presence[m.userId]}
                />
                <span className="min-w-0 flex-1 truncate">{display}</span>
                {/* Role + action live in ONE consistent row (§22). */}
                {m.role === "ADMIN" && (
                  <span className="rounded bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand-strong">
                    Admin
                  </span>
                )}
                {canRemove &&
                  (confirmingRemove === m.userId ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Confirm remove ${user?.displayName ?? m.userId}`}
                        data-testid={`confirm-remove-${m.userId}`}
                        disabled={removeBusy}
                        onClick={() => {
                          void removeMember(m.userId);
                        }}
                        className="rounded bg-danger-strong px-1.5 py-0.5 text-[10px] font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel remove"
                        onClick={() => {
                          setConfirmingRemove(null);
                        }}
                        className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-ink-2"
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
                      className="rounded px-1.5 py-1 text-[11px] font-medium text-ink-3 transition-colors duration-fast hover:text-danger"
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>

        {/* Danger zone: group lifecycle ender — two-step destructive
            confirmation, admin-only. The canonical conversation.deleted
            event removes the group everywhere without reload. */}
        {conversation.type === "GROUP" && isAdmin && (
          <div className="mt-8 rounded-lg border border-danger/25 bg-danger-soft p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">
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
                className="mt-2 w-full rounded-lg border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors duration-fast hover:bg-danger hover:text-on-brand disabled:opacity-50"
              >
                Delete Group
              </button>
            ) : (
              <div className="mt-2" data-testid="delete-group-confirm">
                <p className="text-xs text-ink-2">
                  Delete “{conversation.title ?? "Group"}”? This group will be removed for all{" "}
                  {members.length} members.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                    }}
                    className="rounded-lg border border-line-strong px-3 py-1 text-xs text-ink-2 hover:bg-raised"
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
                    className="rounded-lg bg-danger-strong px-3 py-1 text-xs font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
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
