/**
 * Face ID / Touch ID unlock via WebAuthn's platform authenticator.
 *
 * There is no server here, so the assertion signature is never verified
 * remotely — a successful ceremony is taken as proof. That is the same
 * trust model as the 4-digit code, whose hash also lives on the device:
 * both keep other people out of the app, neither survives someone with
 * developer tools on an unlocked phone. The code always remains as a
 * fallback, since biometrics can and do fail.
 */

const RP_NAME = "swoosh";
const USER_ID = new TextEncoder().encode("swoosh-local-user").buffer as ArrayBuffer;

function toBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns an ArrayBuffer rather than a view: BufferSource in lib.dom is
 *  pinned to ArrayBuffer, and a Uint8Array can be backed by SharedArrayBuffer. */
function fromBase64url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function challenge(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

/** Why Face ID isn't available here, or null when it is. */
export async function faceIdBlocker(): Promise<string | null> {
  if (typeof window === "undefined") return "not in a browser";
  if (!window.isSecureContext) return "needs https (this page is not a secure context)";
  if (!window.PublicKeyCredential || !navigator.credentials) {
    return "this browser has no WebAuthn support";
  }
  try {
    const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return ok ? null : "no biometric authenticator on this device";
  } catch (err) {
    return describe(err);
  }
}

export async function faceIdAvailable(): Promise<boolean> {
  return (await faceIdBlocker()) === null;
}

/** WebAuthn errors are terse and all look alike; name them plainly. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const name = e?.name ?? "Error";
  const detail = e?.message ? ` — ${e.message}` : "";
  if (name === "NotAllowedError") return `cancelled or timed out (${name})${detail}`;
  if (name === "SecurityError") return `domain mismatch for ${window.location.hostname} (${name})${detail}`;
  if (name === "InvalidStateError") return `already enrolled on this device (${name})${detail}`;
  if (name === "NotSupportedError") return `not supported here (${name})${detail}`;
  if (name === "AbortError") return `aborted (${name})${detail}`;
  return `${name}${detail}`;
}

/** Enrol this device. Returns the credential id, or the reason it failed. */
export async function registerFaceId(): Promise<{ id: string } | { error: string }> {
  const blocker = await faceIdBlocker();
  if (blocker) return { error: blocker };
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge(),
        rp: { name: RP_NAME, id: window.location.hostname },
        user: { id: USER_ID, name: RP_NAME, displayName: RP_NAME },
        // ES256 first, RS256 as a fallback for older authenticators.
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    return cred ? { id: toBase64url(cred.rawId) } : { error: "no credential returned" };
  } catch (err) {
    return { error: describe(err) };
  }
}

/** Prompt for Face ID. ok is true only if the device verified the user. */
export async function verifyFaceId(
  credentialId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        rpId: window.location.hostname,
        allowCredentials: [{ type: "public-key", id: fromBase64url(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return assertion !== null ? { ok: true } : { ok: false, error: "no assertion returned" };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}
