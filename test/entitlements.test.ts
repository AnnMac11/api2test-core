import { test } from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync, sign } from 'crypto';
import { verifyEntitlement, hasFeature, FREE_ENTITLEMENT } from '../src/licensing/entitlements';

// Generate a throwaway key pair for the tests and forge tokens with it.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken(payload: Record<string, unknown>, key = privateKey): string {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'A2T' }));
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(`${header}.${body}`), key);
  return `${header}.${body}.${b64url(sig)}`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

test('no token -> free tier, no features', () => {
  const e = verifyEntitlement(null, pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.plan, 'free');
  assert.deepEqual(e.features, []);
  assert.equal(hasFeature(e, 'e2e'), false);
});

test('valid pro token unlocks all premium features', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1', plan: 'pro', exp: future }), pubPem);
  assert.equal(e.valid, true);
  assert.equal(e.plan, 'pro');
  assert.equal(hasFeature(e, 'e2e'), true);
  assert.equal(hasFeature(e, 'testSets'), true);
  assert.equal(hasFeature(e, 'dashboard'), true);
});

test('explicit features override the plan default', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1', plan: 'pro', features: ['e2e'], exp: future }), pubPem);
  assert.deepEqual(e.features, ['e2e']);
  assert.equal(hasFeature(e, 'dashboard'), false);
});

test('expired token -> free tier (subscription lapse)', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1', plan: 'pro', exp: past }), pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.reason, 'expired');
});

test('tampered payload fails the signature check', () => {
  const token = makeToken({ sub: 'c1', plan: 'free', exp: future });
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ sub: 'c1', plan: 'enterprise', exp: future }))}.${s}`;
  const e = verifyEntitlement(forged, pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.reason, 'bad signature');
});

test('token signed by a different key is rejected', () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const e = verifyEntitlement(makeToken({ sub: 'c1', plan: 'pro', exp: future }, other), pubPem);
  assert.equal(e.valid, false);
});

test('malformed token -> free tier', () => {
  assert.equal(verifyEntitlement('not.a.token', pubPem).valid, false);
  assert.equal(verifyEntitlement('garbage', pubPem).valid, false);
});

test('FREE_ENTITLEMENT is locked down', () => {
  assert.equal(FREE_ENTITLEMENT.valid, false);
  assert.deepEqual(FREE_ENTITLEMENT.features, []);
});
