import { test } from 'node:test';
import assert from 'node:assert';
import { API_METHOD_CATEGORY, methodForApp, methodsByCategory, basePathOptions, tokenOptions } from '../src/services/methodScope';
import { getDefaultApiMethodLibrary } from '../src/data/defaultLibraries';

const METHODS = [
  { methodName: 'GetJsonAsync', category: 'HTTP Requests' },                                  // global
  { methodName: 'PetstoreTestToken', category: 'Authentication', applicationId: 'app-pet' },
  { methodName: 'StripeTestToken', category: 'Authentication', applicationId: 'app-stripe' },
  { methodName: 'PetstoreBasePath', category: 'Base Path', applicationId: 'app-pet' },
];

// ── The scoping rule (lifted from the enterprise client) ──────────────────────────────────────

test('a method is in scope when GLOBAL (no applicationId) or its id matches the selected app', () => {
  assert.equal(methodForApp(METHODS[0], 'app-pet'), true, 'global method is always in scope');
  assert.equal(methodForApp(METHODS[1], 'app-pet'), true, 'matching app id');
  assert.equal(methodForApp(METHODS[2], 'app-pet'), false, 'another app’s method is OUT of scope');
  assert.equal(methodForApp(METHODS[1], undefined), false, 'no app selected -> only GLOBAL methods in scope (enterprise rule)');
  assert.equal(methodForApp(METHODS[0], undefined), true, 'global methods always in scope');
});

test('basePath/token options: the right category, scoped to the app', () => {
  assert.deepEqual(tokenOptions(METHODS, 'app-pet').map(m => m.methodName), ['PetstoreTestToken']);
  assert.deepEqual(basePathOptions(METHODS, 'app-pet').map(m => m.methodName), ['PetstoreBasePath']);
  assert.deepEqual(tokenOptions(METHODS, 'app-stripe').map(m => m.methodName), ['StripeTestToken']);
});

test('category matching is case-insensitive (stored data drifts in case)', () => {
  const drifted = [{ methodName: 'T', category: 'authentication', applicationId: 'a1' }];
  assert.equal(methodsByCategory(drifted, API_METHOD_CATEGORY.AUTH, 'a1').length, 1);
});

// ── Against the REAL seed libraries ───────────────────────────────────────────────────────────

test('seed round-trip: per-app token/base-path methods resolve for their app only', () => {
  for (const lang of ['csharp', 'typescript', 'python'] as const) {
    const seed = getDefaultApiMethodLibrary(lang) as any[];
    const petTokens = tokenOptions(seed, 'app-petstore').map(m => m.methodName.toLowerCase());
    assert.ok(petTokens.some(n => n.includes('petstore')), `${lang}: petstore token missing for app-petstore`);
    assert.ok(!petTokens.some(n => n.includes('stripe')), `${lang}: stripe token leaked into petstore scope`);
  }
});

test('every seeded category exists in API_METHOD_CATEGORY — no method orphaned by the taxonomy', () => {
  const known = new Set(Object.values(API_METHOD_CATEGORY) as string[]);
  for (const lang of ['csharp', 'typescript', 'python'] as const) {
    for (const m of getDefaultApiMethodLibrary(lang) as any[]) {
      if (m.category) assert.ok(known.has(m.category), `${lang}/${m.methodName}: unknown category "${m.category}"`);
    }
  }
});
