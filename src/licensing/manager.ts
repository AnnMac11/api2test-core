/**
 * The one licence access point for every API2Test client (Desktop, VS Code) — HANDOVER §4.
 *
 * Core owns the whole access rule: token verification (./entitlements) + the 60-day trial clock +
 * the licensed/trial/expired resolution. Clients supply only two tiny async stores (where the token
 * and the trial stamp live — files in dataDir for Desktop, SecretStorage/globalState for VS Code)
 * and put UI on top. The 30-day extension is just a longer-dated token through the same path — there
 * is no separate "extend" state.
 *
 * The trial is deliberately SOFT (a local stamp the user could delete to reset) — accepted for the
 * individual/beta audience; see HANDOVER §4.
 */
import { verifyEntitlement, type Entitlement } from './entitlements';

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface TrialData { startedAt: string }

export interface TrialStore {
  get(): Promise<TrialData | null>;
  set(data: TrialData): Promise<void>;
}

export type AccessState = 'licensed' | 'trial' | 'expired';

export interface Access {
  state: AccessState;
  /** Trial only — whole days remaining (rounded up). */
  daysLeft?: number;
  /** Licensed only. */
  expiresAt?: Date | null;
}

export interface LicenseManager {
  /** Resolve the app's access state. Stamps the trial start on first call. */
  getAccess(now?: number): Promise<Access>;
  /**
   * Verify a pasted key and store it ONLY if valid — an invalid key must never change stored
   * state. Returns the entitlement (with the rejection `reason` when invalid) + the fresh access.
   */
  enterKey(token: string, now?: number): Promise<{ entitlement: Entitlement; access: Access }>;
  /** Drop the stored licence — access falls back to the trial clock. */
  removeKey(): Promise<void>;
  /** The stored raw token, or null. */
  getToken(): Promise<string | null>;
}

export const TRIAL_DAYS = 60;
const DAY_MS = 86_400_000;

export function createLicenseManager(opts: {
  tokenStore: TokenStore;
  trialStore: TrialStore;
  /** Test hook — production passes nothing and gets the embedded public key. */
  publicKeyPem?: string;
  trialDays?: number;
}): LicenseManager {
  const { tokenStore, trialStore, publicKeyPem } = opts;
  const trialDays = opts.trialDays ?? TRIAL_DAYS;

  async function ensureTrialStarted(now: number): Promise<TrialData> {
    const existing = await trialStore.get();
    if (existing?.startedAt) return existing;
    const stamped = { startedAt: new Date(now).toISOString() };
    await trialStore.set(stamped);
    return stamped;
  }

  async function getAccess(now: number = Date.now()): Promise<Access> {
    const entitlement = verifyEntitlement(await tokenStore.get(), publicKeyPem, now);
    if (entitlement.valid) return { state: 'licensed', expiresAt: entitlement.expiresAt };

    const trial = await ensureTrialStarted(now);
    const msLeft = Date.parse(trial.startedAt) + trialDays * DAY_MS - now;
    if (msLeft > 0) return { state: 'trial', daysLeft: Math.ceil(msLeft / DAY_MS) };
    return { state: 'expired' };
  }

  return {
    getAccess,
    async enterKey(token: string, now: number = Date.now()) {
      const trimmed = (token || '').trim();
      const entitlement = verifyEntitlement(trimmed, publicKeyPem, now);
      if (entitlement.valid) await tokenStore.set(trimmed);
      return { entitlement, access: await getAccess(now) };
    },
    async removeKey() {
      await tokenStore.clear();
    },
    getToken: () => tokenStore.get(),
  };
}
