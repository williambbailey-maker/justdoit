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

/** Whether this device has a biometric authenticator we can use. */
export async function faceIdAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Enrol this device. Returns the credential id to store, or null if declined. */
export async function registerFaceId(): Promise<string | null> {
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

    return cred ? toBase64url(cred.rawId) : null;
  } catch {
    return null;
  }
}

/** Prompt for Face ID. True only if the device verified the user. */
export async function verifyFaceId(credentialId: string): Promise<boolean> {
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
    return assertion !== null;
  } catch {
    return false;
  }
}
