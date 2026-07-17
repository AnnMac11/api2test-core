import { test } from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync, sign } from 'crypto';
import { createLicenseManager, TRIAL_DAYS, type TokenStore, type TrialStore, type TrialData } from '../src/licensing/manager';

// Ephemeral keypair — same forging approach as entitlements.test.ts.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'A2T' }));
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}

const DAY_MS = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const validToken = () => makeToken({ sub: 'c1', exp: Math.floor((T0 + 400 * DAY_MS) / 1000) });

/** In-memory stores — the same two tiny interfaces Desktop (files) and VS Code (SecretStorage) implement. */
function memStores(): { tokenStore: TokenStore; trialStore: TrialStore; state: { token: string | null; trial: TrialData | null } } {
  const state: { token: string | null; trial: TrialData | null } = { token: null, trial: null };
  return {
    state,
    tokenStore: {
      get: async () => state.token,
      set: async (t: string) => { state.token = t; },
      clear: async () => { state.token = null; },
    },
    trialStore: {
      get: async () => state.trial,
      set: async (d: TrialData) => { state.trial = d; },
    },
  };
}

function manager(s = memStores()) {
  return { s, m: createLicenseManager({ tokenStore: s.tokenStore, trialStore: s.trialStore, publicKeyPem: pubPem }) };
}

test('first access stamps the trial ONCE and reports 60 days', async () => {
  const { s, m } = manager();
  const a = await m.getAccess(T0);
  assert.equal(a.state, 'trial');
  assert.equal(a.daysLeft, TRIAL_DAYS);
  const stamped = s.state.trial?.startedAt;
  assert.ok(stamped);
  // Later access must NOT restamp (idempotent — restamping would reset the clock).
  await m.getAccess(T0 + 10 * DAY_MS);
  assert.equal(s.state.trial?.startedAt, stamped);
});

test('trial counts down (rounded up) and hard-expires after 60 days', async () => {
  const { m } = manager();
  await m.getAccess(T0);
  assert.equal((await m.getAccess(T0 + 59.5 * DAY_MS)).daysLeft, 1);
  assert.equal((await m.getAccess(T0 + 59.5 * DAY_MS)).state, 'trial');
  assert.equal((await m.getAccess(T0 + 60 * DAY_MS)).state, 'expired');
});

test('a valid licence always wins — even after the trial expired (30-day extension path)', async () => {
  const { m } = manager();
  await m.getAccess(T0);
  await m.enterKey(validToken());
  const a = await m.getAccess(T0 + 100 * DAY_MS);
  assert.equal(a.state, 'licensed');
  assert.ok(a.expiresAt instanceof Date);
});

test('enterKey stores ONLY a valid key — an invalid key never changes stored state', async () => {
  const { s, m } = manager();
  await m.enterKey(validToken());
  const stored = s.state.token;
  const r = await m.enterKey('garbage-key');
  assert.equal(r.entitlement.valid, false);
  assert.equal(s.state.token, stored); // the good token must survive the bad attempt
});

test('enterKey trims pasted whitespace', async () => {
  const { s, m } = manager();
  const t = validToken();
  const r = await m.enterKey(`  ${t}\n`);
  assert.equal(r.entitlement.valid, true);
  assert.equal(s.state.token, t);
});

test('an EXPIRED licence token does not license — falls back to trial/expired', async () => {
  const { m } = manager();
  await m.getAccess(T0);
  const expired = makeToken({ sub: 'c1', exp: Math.floor((T0 - DAY_MS) / 1000) });
  const r = await m.enterKey(expired, T0);
  assert.equal(r.entitlement.valid, false);
  assert.equal((await m.getAccess(T0 + DAY_MS)).state, 'trial');
});

test('removeKey reverts to the trial clock, not to licensed', async () => {
  const { m } = manager();
  await m.getAccess(T0);
  await m.enterKey(validToken());
  await m.removeKey();
  assert.equal((await m.getAccess(T0 + DAY_MS)).state, 'trial');
  assert.equal((await m.getAccess(T0 + 61 * DAY_MS)).state, 'expired');
});
