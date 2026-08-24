"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiUser } from "@/lib/api";
import { loadStoredIdentity, saveIdentity } from "@/lib/identity";
import { Avatar, Spinner } from "@mqtt-chat/ui";

/**
 * User picker — no auth in this demo. Identity is chosen here and persisted
 * in localStorage; multiple tabs can pick different users/devices. Product
 * styling (§ identity UX): display name + avatar, never a raw engineering id.
 */

export default function UserPickerPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listUsers()
      .then((r) => setUsers(r.users))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load users"));
  }, []);

  const choose = (userId: string) => {
    // Reuse existing device id so a refresh keeps the same device identity.
    const stored = loadStoredIdentity();
    const deviceId =
      stored?.userId === userId ? stored.deviceId : `web-${Math.random().toString(36).slice(2, 6)}`;
    saveIdentity({ userId, deviceId });
    router.push("/chat");
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-xl">
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-2xl"
          >
            💬
          </span>
          <h1 className="mt-4 text-2xl font-semibold">MQTT Chat</h1>
          <p className="mt-1 text-sm text-ink-2">
            This demo has no authentication — pick an identity to start chatting. Open another
            browser tab to simulate a second user.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}

        {!users && !error && (
          <div className="mt-8 flex justify-center" aria-label="Loading users">
            <Spinner />
          </div>
        )}

        {users && (
          <ul className="mt-6 space-y-2" aria-label="Available users">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  data-user-id={user.id}
                  onClick={() => {
                    choose(user.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left transition-colors duration-fast hover:border-brand-strong hover:bg-raised"
                >
                  <Avatar name={user.displayName} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.displayName}</span>
                  </span>
                  <span aria-hidden className="ml-auto text-ink-3">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
