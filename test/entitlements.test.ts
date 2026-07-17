import { test } from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync, sign } from 'crypto';
import { verifyEntitlement, UNLICENSED } from '../src/licensing/entitlements';

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

test('no token -> unlicensed', () => {
  const e = verifyEntitlement(null, pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.reason, 'no token');
});

test('minimal claims (sub + exp) verify valid — no plan claim required', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1', exp: future }), pubPem);
  assert.equal(e.valid, true);
  assert.ok(e.expiresAt instanceof Date);
});

test('unknown claims are IGNORED — the commercial end-game is open, the token shape stays extensible', () => {
  // A future backend may add product/label/whatever claims; old clients must keep verifying.
  const e = verifyEntitlement(
    makeToken({ sub: 'c1', exp: future, plan: 'legacy', product: 'desktop', anything: 42 }),
    pubPem,
  );
  assert.equal(e.valid, true);
});

test('expired token -> invalid (subscription lapse)', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1', exp: past }), pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.reason, 'expired');
});

test('missing exp -> invalid', () => {
  const e = verifyEntitlement(makeToken({ sub: 'c1' }), pubPem);
  assert.equal(e.valid, false);
});

test('tampered payload fails the signature check', () => {
  const token = makeToken({ sub: 'c1', exp: future });
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ sub: 'someone-else', exp: future }))}.${s}`;
  const e = verifyEntitlement(forged, pubPem);
  assert.equal(e.valid, false);
  assert.equal(e.reason, 'bad signature');
});

test('token signed by a different key is rejected', () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const e = verifyEntitlement(makeToken({ sub: 'c1', exp: future }, other), pubPem);
  assert.equal(e.valid, false);
});

test('malformed token -> unlicensed', () => {
  assert.equal(verifyEntitlement('not.a.token', pubPem).valid, false);
  assert.equal(verifyEntitlement('garbage', pubPem).valid, false);
});

test('UNLICENSED is locked down', () => {
  assert.equal(UNLICENSED.valid, false);
  assert.equal(UNLICENSED.expiresAt, null);
});
