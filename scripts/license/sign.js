/*
 * Phase-1 manual entitlement-token issuer. Signs a token with the Ed25519 private key so you can
 * test gating before the licensing backend exists. In production the backend (after verifying the
 * Stripe subscription) does this — never ship the private key.
 *
 *   node scripts/license/sign.js --sub cus_123 --days 30 [--key <private.pem>]
 *
 * Prints the signed token to paste into the app's "Enter Licence Key". Claims are MINIMAL by
 * design (sub/exp/iat/iss — no plan/features): the commercial end-game is open and clients ignore
 * unknown claims, so add claims only deliberately (HANDOVER §4). Lifetime = large --days
 * (e.g. 36500); beta/subscription ≈ 365; trial extension ≈ 30.
 */
const { sign } = require('crypto');
const { createPrivateKey } = require('crypto');
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const sub = arg('sub', 'dev-customer');
const days = parseFloat(arg('days', '30'));

const privPath = arg('key', path.join(__dirname, 'keys', 'private.pem'));
if (!fs.existsSync(privPath)) {
  console.error('Missing private key. Run: node scripts/license/generate-keys.js');
  process.exit(1);
}
const privateKey = createPrivateKey(fs.readFileSync(privPath, 'utf8'));

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nowSec = Math.floor(Date.now() / 1000);
const header = { alg: 'EdDSA', typ: 'A2T' };
const payload = { sub, exp: nowSec + Math.round(days * 86400), iat: nowSec, iss: 'api2test' };

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = sign(null, Buffer.from(signingInput), privateKey);
const token = `${signingInput}.${b64url(signature)}`;

console.log(`sub: ${sub} | expires in ${days} day(s)\n`);
console.log(token);
