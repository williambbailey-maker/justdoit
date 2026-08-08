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

/** Running from the home screen rather than in the browser. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

export type FaceIdStatus =
  /** Everything checks out. */
  | { state: "ready" }
  /** The device says no, but the check is advisory — enrolling may still work. */
  | { state: "unlikely"; reason: string }
  /** Nothing to try: no API, or not a secure context. */
  | { state: "blocked"; reason: string };

export async function faceIdStatus(): Promise<FaceIdStatus> {
  if (typeof window === "undefined") return { state: "blocked", reason: "not in a browser" };
  if (!window.isSecureContext) {
    return { state: "blocked", reason: "this page is not served over https" };
  }
  if (!window.PublicKeyCredential || !navigator.credentials) {
    return { state: "blocked", reason: "this browser has no WebAuthn support" };
  }

  try {
    if (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) {
      return { state: "ready" };
    }
  } catch {
    // Fall through: a throwing check is no more final than a false one.
  }

  // iOS reports no authenticator inside a home-screen web app even on a phone
  // with Face ID. The check is a hint, not a verdict, so the caller is still
  // allowed to attempt enrolment.
  return {
    state: "unlikely",
    reason: isStandalone()
      ? "iOS often reports no authenticator inside a home-screen app, even when Face ID works"
      : "this device reports no biometric authenticator",
  };
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
  const status = await faceIdStatus();
  // Only a hard block stops us — "unlikely" is worth attempting anyway.
  if (status.state === "blocked") return { error: status.reason };
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
