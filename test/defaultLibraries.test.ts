import { test } from 'node:test';
import assert from 'node:assert';
import {
  getDefaultDataLibrary,
  getDefaultApiMethodLibrary,
  mergeDefaults,
} from '../src/data/defaultLibraries';
import { chooseSendMethod, chooseExtractMethod } from '../src/services/e2eMethodSelection';

test('csharp libraries return the canonical built-in sets', () => {
  assert.equal(getDefaultDataLibrary('csharp').length, 100);
  assert.equal(getDefaultApiMethodLibrary('csharp').length, 26);
});

test('csharp api-method library includes the negative-response validators', () => {
  const names = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const v of [
    'ValidateBadRequest_400Async',
    'ValidateUnauthorized_401Async',
    'ValidateForbidden_403Async',
    'ValidateNotFound_404Async',
    'ValidateConflict_409Async',
    'ValidateValidationError_422Async',
  ]) {
    assert.ok(names.has(v), `expected negative validator ${v}`);
  }
});

test('csharp wrapper library uses the names the generators emit', () => {
  const names = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const expected of ['PostJsonAsync', 'PostFormAsync', 'UploadFileAsync', 'GetAsync']) {
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

test('typescript api-method library is at validator parity with csharp/python', () => {
  // TS previously lagged: it lacked the delete/forbidden/conflict/validation-error validators, so
  // chooseExtractMethod's DELETE default would return a name that doesn't exist in TS.
  assert.equal(getDefaultApiMethodLibrary('typescript').length, 22);
  const names = new Set(getDefaultApiMethodLibrary('typescript').map((m) => m.methodName));
  for (const v of [
    'ValidateDeleted_200_204Async',      // the DELETE extract default
    'ValidateForbidden_403Async',
    'ValidateConflict_409Async',
    'ValidateValidationError_422Async',
  ]) {
    assert.ok(names.has(v), `typescript: expected validator ${v}`);
  }
});

test('every validator chooseExtractMethod can pick exists in all 3 languages', () => {
  // The by-verb extract defaults: DELETE -> 200/204, everything else -> 200/201.
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultApiMethodLibrary(lang).map((m) => m.methodName));
    // Taken from chooseExtractMethod itself, so a rename on one side can't drift from the other.
    for (const v of [chooseExtractMethod('', 'GET'), chooseExtractMethod('', 'DELETE'), chooseExtractMethod('id')]) {
      assert.ok(names.has(v), `${lang}: expected extract/validate method ${v}`);
    }
  }
});

test('SEND-1: every send method hands its follow-up the response type that follow-up declares', () => {
  // The generated step is always `send(...)` → `Validate*(response)` / `ExtractField*(response, …)`.
  // That only compiles when the send RETURNS what the follow-up TAKES. `GetAsync` was the one helper
  // that returned the deserialised payload instead of the response, so every GET step in every
  // generated test failed to compile (CS1503: cannot convert from 'object' to HttpResponseMessage),
  // and its internal EnsureSuccessStatusCode/raise_for_status meant a GET could never be validated at
  // all — a negative 404 test threw before the validator ran. This pins the contract for all 5 verbs.
  const responseType: Record<string, RegExp> = {
    csharp: /HttpResponseMessage/i,
    python: /HttpResponseMessage/i,   // python entries carry the shared C#-style type strings
    typescript: /\bResponse\b/,
  };
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const methods = getDefaultApiMethodLibrary(lang);
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const send = methods.find((m) => m.methodName === chooseSendMethod(verb));
      assert.ok(send, `${lang}: no library method for ${verb}`);
      assert.match(send!.returnType || '', responseType[lang],
        `${lang}: ${send!.methodName} must return the response, not a deserialised body`);

      const followUp = methods.find((m) => m.methodName === chooseExtractMethod('', verb));
      assert.ok(followUp, `${lang}: no follow-up for ${verb}`);
      assert.match(followUp!.parameters || '', responseType[lang],
        `${lang}: ${followUp!.methodName} takes the response ${send!.methodName} returns`);
    }
  }
});

test('NAME-1: library method names say what they do — no stale names survive', () => {
  // The names are the API the user picks from in the builder, so they have to read as the action and
  // (for a validator) the status code it accepts. These are the names that were replaced.
  const retired = [
    'ExtractFieldFromResponse', 'ExtractTokenFromResponse', 'ParseJsonResponse',
    'DeleteByParamAsync', 'PostMultipartAsync',
    'ValidateResponseAsync', 'ValidateDeleteResponseAsync', 'ValidateBadRequestResponseAsync',
    'ValidateUnauthorizedResponseAsync', 'ValidateForbiddenResponseAsync', 'ValidateNotFoundResponseAsync',
    'ValidateConflictResponseAsync', 'ValidateValidationErrorResponseAsync',
    'petstoreTestBasePath', 'petstoreTestToken', 'stripeTestBasePath', 'stripeTestToken',
  ];
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultApiMethodLibrary(lang).map((m) => m.methodName));
    for (const old of retired) {
      assert.equal(names.has(old), false, `${lang}: retired name ${old} is still shipped`);
    }
  }
  // Every validator names its status code(s), so the dropdown reads right without the description.
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    for (const m of getDefaultApiMethodLibrary(lang)) {
      if (!/^Validate/.test(m.methodName)) { continue; }
      assert.match(m.methodName, /_\d{3}(_\d{3})?Async$/, `${lang}: ${m.methodName} must carry its status code`);
    }
  }
});

test('accessors hand out fresh copies (mutation does not leak)', () => {
  const a = getDefaultDataLibrary('csharp');
  a.pop();
  assert.equal(getDefaultDataLibrary('csharp').length, 100);
});

test('python libraries mirror the csharp set (same methods, Python bodies)', () => {
  const py = getDefaultDataLibrary('python');
  const cs = getDefaultDataLibrary('csharp');
  assert.equal(py.length, 100);
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
    // A boolean url param is rare but must still bind SOMETHING (an unmatched mandatory field blocks class
    // generation), so a false-returning placeholder completes the type set. The runtime value overwrites it.
    assert.equal(byName['ParameterBool']?.returnType, 'bool', `${lang}: ParameterBool is a bool`);
    assert.match(byName['ParameterBool']?.code || '', /false/i, `${lang}: ParameterBool returns false`);
  }
});

test('SEED-2: PhotoUrls and Tags array-field methods are curated in all 3 languages', () => {
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultDataLibrary(lang).map((m) => m.methodName));
    assert.ok(names.has('PhotoUrls'), `${lang}: expected curated PhotoUrls`);
    assert.ok(names.has('Tags'), `${lang}: expected curated Tags`);
  }
});

test('SEED-3: date/Twilio/Percent methods renamed for A-Z order and casing', () => {
  for (const lang of ['csharp', 'python'] as const) {
    const names = new Set(getDefaultDataLibrary(lang).map((m) => m.methodName));
    for (const gone of ['GetDate', 'GetDateStr', 'GetDateTimeStr', 'twilioToken', 'twilioSID', 'Percentage']) {
      assert.ok(!names.has(gone), `${lang}: ${gone} should be renamed away`);
    }
    for (const now of ['DateNow', 'DateStr', 'DateTimeStr', 'TwilioToken', 'TwilioSid', 'Percent']) {
      assert.ok(names.has(now), `${lang}: expected renamed ${now}`);
    }
  }
  // ids survive the rename so refreshDefaults propagates it to existing stores
  const byId = Object.fromEntries(getDefaultDataLibrary('csharp').map((m) => [m.id, m]));
  assert.equal(byId['13']?.methodName, 'DateNow', 'GetDate kept id 13');
  assert.equal(byId['14']?.methodName, 'DateStr', 'GetDateStr kept id 14');
  assert.equal(byId['15']?.methodName, 'DateTimeStr', 'GetDateTimeStr kept id 15');
});

test('SEED-5: DateOfBirth is a DateOnly — a birth date has no time component', () => {
  for (const lang of ['csharp', 'python'] as const) {
    const dob = getDefaultDataLibrary(lang).find((m) => m.methodName === 'DateOfBirth');
    assert.equal(dob?.returnType, 'DateOnly', `${lang}: DateOfBirth must be DateOnly, not DateTime`);
  }
});

test('SEED-4: RandomInt and UnixTimestamp curated in all 3 languages', () => {
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const byName = Object.fromEntries(getDefaultDataLibrary(lang).map((m) => [m.methodName, m]));
    assert.equal(byName['RandomInt']?.returnType, 'int', `${lang}: RandomInt is an int`);
    assert.equal(byName['UnixTimestamp']?.returnType, 'long', `${lang}: UnixTimestamp is a long (epoch seconds)`);
  }
});

test('mergeDefaults adds missing defaults and preserves user items', () => {
  const userCustom = { methodName: 'MyCustomThing', code: 'x' };
  const existing = [userCustom, { methodName: 'FirstName' }];
  const merged = mergeDefaults(existing, getDefaultDataLibrary('csharp'));
  // user's custom method survives, FirstName is not duplicated, the rest are added
  assert.ok(merged.includes(userCustom), 'user custom preserved');
  assert.equal(merged.filter((m: any) => m.methodName === 'FirstName').length, 1, 'no duplicate');
  assert.equal(merged.length, 100 + 1, 'all defaults present plus the one custom');
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
  assert.equal(merged.length, 100);
});
