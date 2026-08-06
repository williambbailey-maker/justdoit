const UNLOCK_KEY = "suush:unlocked-at";

export async function hashCode(code: string): Promise<string> {
  // The salt is fixed across the rename so an already-set code keeps working.
  const bytes = new TextEncoder().encode(`suush:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function markUnlocked() {
  sessionStorage.setItem(UNLOCK_KEY, String(Date.now()));
}

export function clearUnlocked() {
  sessionStorage.removeItem(UNLOCK_KEY);
}

/** Refresh the activity timestamp so an active session doesn't auto-lock. */
export function touchUnlocked() {
  if (sessionStorage.getItem(UNLOCK_KEY)) markUnlocked();
}

export function isUnlocked(autoLockMinutes: number): boolean {
  const at = sessionStorage.getItem(UNLOCK_KEY);
  if (!at) return false;
  if (autoLockMinutes <= 0) return true;
  return Date.now() - Number(at) < autoLockMinutes * 60_000;
}
