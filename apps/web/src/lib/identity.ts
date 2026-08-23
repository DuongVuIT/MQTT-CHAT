/**
 * @description  Demo identity persistence — no auth. Identity is chosen in the UI and persisted in localStorage.
 * @since         Sunday, 8 23rd 2026, 1:02:36 am
 * @author        Vũ Đại Dương <duongvd@getflycrm.com>
 * @copyright     Copyright (c) 2026, GETFLY VN TECH.,JSC
 */

export interface StoredIdentity {
  userId: string;
  deviceId: string;
}

const STORAGE_KEY = "mqtt-chat-identity";

export function loadStoredIdentity(): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: StoredIdentity): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
