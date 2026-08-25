"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatMarkIcon, ChevronRightIcon } from "@/components/icons";
import { api, type ApiUser } from "@/lib/api";
import { loadStoredIdentity, saveIdentity } from "@/lib/identity";
import { Avatar, Spinner } from "@mqtt-chat/ui";

export default function UserPickerPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listUsers()
      .then((response) => {
        setUsers(response.users);
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Failed to load users");
      });
  }, []);

  const chooseIdentity = (userId: string): void => {
    const storedIdentity = loadStoredIdentity();
    const deviceId =
      storedIdentity?.userId === userId
        ? storedIdentity.deviceId
        : `web-${Math.random().toString(36).slice(2, 6)}`;

    saveIdentity({ userId, deviceId });
    router.push("/chat");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-5 sm:p-8">
      <div
        aria-hidden
        className="absolute left-[8%] top-[12%] h-56 w-56 rounded-full bg-brand/10 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute bottom-[8%] right-[10%] h-64 w-64 rounded-full bg-accent/10 blur-3xl"
      />

      <section className="glass-surface relative grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-line lg:grid-cols-[1.08fr_0.92fr]">
        <div className="flex flex-col justify-between border-b border-line p-8 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-raised/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-strong">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Realtime workspace
            </div>
            <div className="mt-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-floating">
              <ChatMarkIcon className="h-8 w-8" />
            </div>
            <h1 className="mt-7 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Conversations,
              <span className="block text-brand-strong">kept in sync.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-ink-2">
              A focused MQTT chat workspace for Web and Mobile, with reliable delivery, presence,
              media and bot automation.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-3 text-xs text-ink-3 lg:mt-16">
            <span>Web + Mobile</span>
            <span>MQTT realtime</span>
            <span>Server verified</span>
          </div>
        </div>

        <div className="bg-surface/75 p-7 sm:p-10 lg:p-12">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">Choose profile</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
            Continue to your chats
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-2">
            Authentication is not enabled in this project. Select a seeded identity to continue.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
            >
              {error}
            </p>
          )}

          {!users && !error && (
            <div className="mt-10 flex justify-center" aria-label="Loading users">
              <Spinner />
            </div>
          )}

          {users && (
            <ul className="mt-6 space-y-2.5" aria-label="Available users">
              {users.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    data-user-id={user.id}
                    onClick={() => {
                      chooseIdentity(user.id);
                    }}
                    className="group flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-raised/55 px-4 py-3 text-left transition-all duration-normal hover:-translate-y-0.5 hover:border-brand/60 hover:bg-high hover:shadow-panel"
                  >
                    <Avatar name={user.displayName} colorKey={user.id} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{user.displayName}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">Open workspace</span>
                    </span>
                    <ChevronRightIcon className="h-5 w-5 text-ink-3 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-brand-strong" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
