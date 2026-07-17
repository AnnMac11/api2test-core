/**
 * Offline verification of API2Test entitlement tokens.
 *
 * A token is a compact `base64url(header).base64url(payload).base64url(signature)` string, where the
 * signature is Ed25519 over `header.payload`. The licensing backend signs tokens with the PRIVATE
 * key; clients verify them offline with the embedded PUBLIC key — so the VSIX/app never call out or
 * hold a secret. Subscription lapse is handled by the short `exp`: the backend simply stops
 * reissuing, and the cached token expires.
 *
 * The model is a WHOLE-APP gate (no per-feature gating, no free tier — HANDOVER §4): a token is
 * either valid or it isn't. Claims are deliberately minimal and the verifier IGNORES unknown claims —
 * the commercial end-game is undecided, so the token shape must stay extensible without breaking
 * already-shipped clients.
 *
 * No external dependencies — uses Node's built-in crypto, so it bundles cleanly into the VSIX.
 */
import { createPublicKey, verify } from 'crypto';

/** Claims carried in a signed entitlement token's payload. Unknown extra claims are ignored. */
export interface EntitlementClaims {
  /** Subject — license id / customer id. */
  sub: string;
  /** Expiry, Unix seconds (lifetime = far-future; subscription = ~1 year, reissued on renewal). */
  exp: number;
  /** Issued-at, Unix seconds (optional). */
  iat?: number;
  /** Issuer (optional). */
  iss?: string;
}

/** The resolved entitlement a client gates on. */
export interface Entitlement {
  valid: boolean;
  expiresAt: Date | null;
  /** Present when invalid: why the token was rejected (expired/malformed/signature/…). */
  reason?: string;
}

/** The entitlement when there is no (valid) token. There is no free tier — gating fails safe. */
export const UNLICENSED: Entitlement = { valid: false, expiresAt: null };

/**
 * Embedded public key clients use to verify tokens. This is a DEVELOPMENT key — regenerate for
 * production with scripts/license/generate-keys.js and replace this value; keep the private key
 * only on the licensing backend.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmtoxA3g5fA0VVLI2y2VUUPvPsKYxTTgKQVpzCQ+jgQE=
-----END PUBLIC KEY-----`;

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a signed entitlement token and resolve the entitlement. Returns UNLICENSED (with a
 * `reason`) for any missing/malformed/expired/forged token — gating should always fail safe.
 *
 * @param token        The signed token, or null/undefined for an unlicensed client.
 * @param publicKeyPem Verifying key (defaults to the embedded {@link LICENSE_PUBLIC_KEY}).
 * @param now          Current time in ms (injectable for tests).
 */
export function verifyEntitlement(
  token: string | null | undefined,
  publicKeyPem: string = LICENSE_PUBLIC_KEY,
  now: number = Date.now(),
): Entitlement {
  if (!token) return { ...UNLICENSED, reason: 'no token' };
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return reject('malformed');
    const [header, payload, signature] = parts;

    const signed = Buffer.from(`${header}.${payload}`);
    const sig = b64urlToBuffer(signature);
    const key = createPublicKey(publicKeyPem);
    // Ed25519 verification uses algorithm `null`.
    if (!verify(null, signed, key, sig)) return reject('bad signature');

    const claims = JSON.parse(b64urlToBuffer(payload).toString('utf8')) as EntitlementClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return reject('expired');

    return { valid: true, expiresAt: new Date(claims.exp * 1000) };
  } catch {
    return reject('error');
  }
}

function reject(reason: string): Entitlement {
  return { ...UNLICENSED, reason };
}
