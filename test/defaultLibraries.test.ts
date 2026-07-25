import { test } from 'node:test';
import assert from 'node:assert';
import {
  getDefaultDataLibrary,
  getDefaultApiMethodLibrary,
  mergeDefaults,
} from '../src/data/defaultLibraries';

test('csharp libraries return the canonical built-in sets', () => {
  assert.equal(getDefaultDataLibrary('csharp').length, 97);
  assert.equal(getDefaultApiMethodLibrary('csharp').length, 26);
});

test('csharp api-method library includes the negative-response validators', () => {
  const names = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const v of [
    'ValidateBadRequestResponseAsync',       // 400
    'ValidateUnauthorizedResponseAsync',     // 401
    'ValidateForbiddenResponseAsync',        // 403
    'ValidateNotFoundResponseAsync',         // 404
    'ValidateConflictResponseAsync',         // 409
    'ValidateValidationErrorResponseAsync',  // 422
  ]) {
    assert.ok(names.has(v), `expected negative validator ${v}`);
  }
});

test('csharp wrapper library uses the names the generators emit', () => {
  const names = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const expected of ['PostJsonAsync', 'PostFormAsync', 'PostMultipartAsync', 'GetAsync']) {
    assert.ok(names.has(expected), `expected wrapper ${expected}`);
  }
});

test('every body verb × content-type has a send method (PUT/PATCH form + PATCH json) in all 3 languages', () => {
  // chooseSendMethod (E2E-SEL-1) maps verb + form/json to a library method; a form PUT or any PATCH
  // previously had nothing to select. These fill that matrix — must exist in every language.
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultApiMethodLibrary(lang).map((m) => m.methodName));
    for (const send of ['PutFormAsync', 'PatchJsonAsync', 'PatchFormAsync']) {
      assert.ok(names.has(send), `${lang}: expected send method ${send}`);
    }
  }
});

test('accessors hand out fresh copies (mutation does not leak)', () => {
  const a = getDefaultDataLibrary('csharp');
  a.pop();
  assert.equal(getDefaultDataLibrary('csharp').length, 97);
});

test('python libraries mirror the csharp set (same methods, Python bodies)', () => {
  const py = getDefaultDataLibrary('python');
  const cs = getDefaultDataLibrary('csharp');
  assert.equal(py.length, 97);
  assert.equal(getDefaultApiMethodLibrary('python').length, 26);
  // same methodNames (auto-matching parity), but Python code bodies
  assert.deepEqual(py.map((m) => m.methodName).sort(), cs.map((m) => m.methodName).sort());
  const firstName = py.find((m) => m.methodName === 'FirstName')!;
  assert.match(firstName.code, /def first_name\(self\)/);
  assert.match(firstName.code, /self\._fake\.first_name\(\)/);
});

test('data library includes the per-type Parameter placeholders (#56)', () => {
  for (const lang of ['csharp', 'python'] as const) {
    const byName = Object.fromEntries(getDefaultDataLibrary(lang).map((m) => [m.methodName, m]));
    assert.equal(byName['ParameterString']?.returnType, 'string', `${lang}: ParameterString is a string`);
    assert.match(byName['ParameterString']?.code || '', /parameter/i, `${lang}: ParameterString returns "parameter"`);
    assert.equal(byName['ParameterInt']?.returnType, 'int', `${lang}: ParameterInt is an int`);
    assert.match(byName['ParameterInt']?.code || '', /99999/, `${lang}: ParameterInt returns 99999`);
    assert.equal(byName['ParameterDate']?.returnType, 'DateTime', `${lang}: ParameterDate is a DateTime`);
    assert.match(byName['ParameterDate']?.code || '', /1900/, `${lang}: ParameterDate returns 1900-01-01`);
    // boolean is deliberately omitted — no ParameterBool.
    assert.ok(!byName['ParameterBool'] && !byName['ParameterBoolean'], `${lang}: no boolean placeholder`);
  }
});

test('SEED-2: PhotoUrls and Tags array-field methods are curated in all 3 languages', () => {
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultDataLibrary(lang).map((m) => m.methodName));
    assert.ok(names.has('PhotoUrls'), `${lang}: expected curated PhotoUrls`);
    assert.ok(names.has('Tags'), `${lang}: expected curated Tags`);
  }
});

test('mergeDefaults adds missing defaults and preserves user items', () => {
  const userCustom = { methodName: 'MyCustomThing', code: 'x' };
  const existing = [userCustom, { methodName: 'FirstName' }];
  const merged = mergeDefaults(existing, getDefaultDataLibrary('csharp'));
  // user's custom method survives, FirstName is not duplicated, the rest are added
  assert.ok(merged.includes(userCustom), 'user custom preserved');
  assert.equal(merged.filter((m: any) => m.methodName === 'FirstName').length, 1, 'no duplicate');
  assert.equal(merged.length, 97 + 1, 'all defaults present plus the one custom');
});

test('every seeded base-path / token method is attached to an application by id', () => {
  // A base-path or token method carries an application-specific value, so it must link to an
  // application via applicationId — never float unattached (which would silently drop it from the
  // app-scoped dropdowns). Utility helpers stay global. Guards against the drift that let a method
  // tagged "PetStore" miss the "Pet Store" application.
  const KNOWN_APP_IDS = new Set(['app-petstore', 'app-stripe']);
  for (const lang of ['csharp', 'python'] as const) {
    const methods = getDefaultApiMethodLibrary(lang);
    const appScoped = methods.filter((m) => m.category === 'Base Path' || m.category === 'Authentication');
    assert.ok(appScoped.length > 0, `${lang}: expected some app-scoped methods`);
    for (const m of appScoped) {
      assert.ok(m.applicationId && m.applicationId.trim(), `${lang}: ${m.methodName} must set applicationId`);
      assert.ok(KNOWN_APP_IDS.has(m.applicationId!), `${lang}: ${m.methodName} applicationId ${m.applicationId} must be a seeded app id`);
    }
    // The retired floating generic base path must not come back.
    assert.ok(!methods.some((m) => m.methodName === 'ApiBaseUrl'), `${lang}: ApiBaseUrl is retired`);
    // Utility helpers stay global (no applicationId).
    const util = methods.find((m) => m.methodName === 'GetAsync');
    assert.ok(util && !util.applicationId, 'GetAsync stays a global utility');
  }
});

test('mergeDefaults returns the same array when nothing is missing', () => {
  const defaults = getDefaultDataLibrary('csharp');
  const merged = mergeDefaults(defaults, defaults);
  assert.equal(merged.length, 97);
});
