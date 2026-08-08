/**
 * Deliberately localStorage, not sessionStorage. iOS discards a standalone
 * web app's session the moment it evicts it from memory, which is often —
 * so a session-scoped unlock meant being challenged on practically every
 * launch. Persisting it means the auto-lock window is what actually decides,
 * the way a native app behaves.
 */
const UNLOCK_KEY = "suush:unlocked-at";

const store = () => window.localStorage;

export async function hashCode(code: string): Promise<string> {
  // The salt is fixed across the rename so an already-set code keeps working.
  const bytes = new TextEncoder().encode(`suush:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function markUnlocked() {
  store().setItem(UNLOCK_KEY, String(Date.now()));
}

export function clearUnlocked() {
  store().removeItem(UNLOCK_KEY);
}

/** Refresh the activity timestamp so an app in use doesn't auto-lock. */
export function touchUnlocked() {
  if (store().getItem(UNLOCK_KEY)) markUnlocked();
}

export function isUnlocked(autoLockMinutes: number): boolean {
  const at = store().getItem(UNLOCK_KEY);
  if (!at) return false;
  if (autoLockMinutes <= 0) return true;
  return Date.now() - Number(at) < autoLockMinutes * 60_000;
}
