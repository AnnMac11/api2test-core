/*
 * Generates an Ed25519 key pair for signing API2Test license/entitlement tokens.
 *
 *   node scripts/license/generate-keys.js
 *
 * - PRIVATE key -> scripts/license/keys/private.pem  (gitignored — keep secret, used by sign.js
 *   and, in production, only by the licensing backend).
 * - PUBLIC key  -> printed; paste it into LICENSE_PUBLIC_KEY in src/licensing/entitlements.ts so
 *   clients can verify tokens offline.
 *
 * Regenerate for production and replace the embedded public key; never commit the private key.
 */
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, 'keys');
fs.mkdirSync(keysDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(path.join(keysDir, 'private.pem'), privPem);
fs.writeFileSync(path.join(keysDir, 'public.pem'), pubPem);

console.log('Wrote scripts/license/keys/{private,public}.pem');
console.log('\n--- PUBLIC KEY (embed in src/licensing/entitlements.ts) ---\n');
console.log(pubPem);
