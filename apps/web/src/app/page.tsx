"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiUser } from "@/lib/api";
import { loadStoredIdentity, saveIdentity } from "@/lib/identity";
import { Spinner } from "@mqtt-chat/ui";

/**
 * User picker — no auth in this demo. Identity is chosen here and persisted
 * in localStorage; multiple tabs can pick different users/devices.
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
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold">Who are you?</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          This demo has no authentication — pick an identity to start chatting. Open another browser
          tab to simulate a second user.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
          >
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
                  onClick={() => {
                    choose(user.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:hover:border-indigo-500 dark:hover:bg-slate-800"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 font-medium text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <span className="block font-medium">{user.displayName}</span>
                    <span className="block text-xs text-slate-400">{user.id}</span>
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
