import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { verifyEntitlement } from '../src/licensing/entitlements';
import { tmpDir } from './tmp';

// Drive the REAL scripts end-to-end: generate a keypair, sign a token, verify it with the
// production verify path. No mocking — this is exactly the release/issuing flow (LIC-4).
const scripts = path.join(__dirname, '..', 'scripts', 'license');
const outDir = tmpDir('a2t-license-');

function run(script: string, args: string[]): string {
  return execFileSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8' });
}

/** sign.js prints a human line then the token — the token is the last non-empty line. */
function lastLine(out: string): string {
  const lines = out.trim().split('\n');
  return lines[lines.length - 1].trim();
}

test('generate-keys → sign → verifyEntitlement round-trip (minimal claims, no plan)', () => {
  run('generate-keys.js', [outDir]);
  const pub = fs.readFileSync(path.join(outDir, 'public.pem'), 'utf8');
  assert.ok(pub.includes('BEGIN PUBLIC KEY'));

  const token = lastLine(run('sign.js', ['--key', path.join(outDir, 'private.pem'), '--sub', 'beta-001', '--days', '60']));
  const e = verifyEntitlement(token, pub);
  assert.equal(e.valid, true);
  assert.ok(e.expiresAt && e.expiresAt.getTime() > Date.now());

  // Pin the minimal-claims shape: no plan/features in the payload (end-game stays open).
  const claims = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'iss', 'sub']);
});

test('a token signed with a FRESH keypair is rejected by a different public key', () => {
  const otherDir = tmpDir('a2t-license-other-');
  run('generate-keys.js', [otherDir]);
  const token = lastLine(run('sign.js', ['--key', path.join(otherDir, 'private.pem'), '--sub', 'x', '--days', '60']));
  const pub = fs.readFileSync(path.join(outDir, 'public.pem'), 'utf8');
  assert.equal(verifyEntitlement(token, pub).valid, false);
});

test('negative days signs an already-expired token → invalid', () => {
  const token = lastLine(run('sign.js', ['--key', path.join(outDir, 'private.pem'), '--sub', 'x', '--days', '-1']));
  const pub = fs.readFileSync(path.join(outDir, 'public.pem'), 'utf8');
  assert.equal(verifyEntitlement(token, pub).reason, 'expired');
});
