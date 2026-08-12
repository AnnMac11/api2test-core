import { test } from 'node:test';
import assert from 'node:assert';
import { chooseSendMethod, chooseExtractMethod, isFormEncoded, canonicalMethodName } from '../src/services/e2eMethodSelection';
import { getDefaultApiMethodLibrary } from '../src/data/defaultLibraries';

test('isFormEncoded is true only for x-www-form-urlencoded (case/charset tolerant)', () => {
  assert.equal(isFormEncoded('application/x-www-form-urlencoded'), true);
  assert.equal(isFormEncoded('Application/X-WWW-Form-Urlencoded; charset=UTF-8'), true);
  assert.equal(isFormEncoded('application/json'), false);
  assert.equal(isFormEncoded(''), false);
  assert.equal(isFormEncoded(undefined), false);
});

test('chooseSendMethod picks the verb-appropriate send method, form vs json aware', () => {
  // The user rule: "the methods to send the class is selected by the class POST PUT etc."
  assert.equal(chooseSendMethod('GET'), 'GetAsync');
  assert.equal(chooseSendMethod('DELETE'), 'DeleteAsync');
  // JSON (default) vs form for every body verb.
  assert.equal(chooseSendMethod('POST', 'application/json'), 'PostJsonAsync');
  assert.equal(chooseSendMethod('POST', 'application/x-www-form-urlencoded'), 'PostFormAsync');
  assert.equal(chooseSendMethod('PUT', 'application/json'), 'PutJsonAsync');
  assert.equal(chooseSendMethod('PUT', 'application/x-www-form-urlencoded'), 'PutFormAsync');
  assert.equal(chooseSendMethod('PATCH', 'application/json'), 'PatchJsonAsync');
  assert.equal(chooseSendMethod('PATCH', 'application/x-www-form-urlencoded'), 'PatchFormAsync');
});

test('chooseSendMethod is verb-case/whitespace tolerant and defaults body verbs to JSON', () => {
  assert.equal(chooseSendMethod('post'), 'PostJsonAsync');   // no content-type → JSON default
  assert.equal(chooseSendMethod('  Put  '), 'PutJsonAsync');
  assert.equal(chooseSendMethod('patch'), 'PatchJsonAsync');
});

test('chooseSendMethod returns no default for an unknown/missing verb (client keeps full list)', () => {
  assert.equal(chooseSendMethod(''), '');
  assert.equal(chooseSendMethod(undefined), '');
  assert.equal(chooseSendMethod('HEAD'), '');
});

test('chooseExtractMethod extracts when a response field is selected — regardless of verb', () => {
  // A selected response field means "capture this" → the field extractor. The <T> is NOT decided here
  // (it stays with the capture-type picker), so the method name is the same for every verb.
  assert.equal(chooseExtractMethod('id', 'GET'), 'ExtractFieldAsync');
  assert.equal(chooseExtractMethod('data.token', 'POST'), 'ExtractFieldAsync');
  assert.equal(chooseExtractMethod('  status  ', 'DELETE'), 'ExtractFieldAsync');
});

test('chooseExtractMethod validates by verb when NO response field is selected', () => {
  // DELETE passes on 200/204; every other verb (GET 200, POST 201, PUT, PATCH) on 200/201.
  assert.equal(chooseExtractMethod(undefined, 'DELETE'), 'ValidateDeleted_200_204Async');
  assert.equal(chooseExtractMethod('', 'delete'), 'ValidateDeleted_200_204Async'); // case tolerant
  assert.equal(chooseExtractMethod(undefined, 'GET'), 'ValidateSuccess_200_201Async');
  assert.equal(chooseExtractMethod('', 'POST'), 'ValidateSuccess_200_201Async');
  assert.equal(chooseExtractMethod('   ', 'PUT'), 'ValidateSuccess_200_201Async'); // whitespace-only = no field
  assert.equal(chooseExtractMethod(undefined, undefined), 'ValidateSuccess_200_201Async');
});

test('NAME-1: every pre-rename name maps to a method that exists in all 3 seeded libraries', () => {
  // A test case saved before the rename stores the OLD method name. Without the translation the step
  // resolves to nothing and the generated file calls a method the library no longer defines.
  const retired = [
    'ExtractFieldFromResponse', 'ExtractTokenFromResponse', 'ParseJsonResponse', 'DeleteByParamAsync',
    'PostMultipartAsync', 'ValidateResponseAsync', 'ValidateDeleteResponseAsync',
    'ValidateBadRequestResponseAsync', 'ValidateUnauthorizedResponseAsync', 'ValidateForbiddenResponseAsync',
    'ValidateNotFoundResponseAsync', 'ValidateConflictResponseAsync', 'ValidateValidationErrorResponseAsync',
  ];
  const csharp = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const old of retired) {
    const now = canonicalMethodName(old);
    assert.notEqual(now, old, `${old} must translate to its new name`);
    assert.ok(csharp.has(now), `${old} -> ${now} must exist in the library`);
  }
  // An unknown or custom name is left exactly as the user wrote it.
  assert.equal(canonicalMethodName('MyOwnHelperAsync'), 'MyOwnHelperAsync');
  assert.equal(canonicalMethodName(undefined), '');
});

test('every send method chooseSendMethod returns exists in all 3 seeded libraries', () => {
  // A returned name must resolve to a real library method, or the pre-selection is dead.
  const cases: Array<[string, string | undefined]> = [
    ['GET', undefined], ['DELETE', undefined],
    ['POST', 'application/json'], ['POST', 'application/x-www-form-urlencoded'],
    ['PUT', 'application/json'], ['PUT', 'application/x-www-form-urlencoded'],
    ['PATCH', 'application/json'], ['PATCH', 'application/x-www-form-urlencoded'],
  ];
  for (const lang of ['csharp', 'python', 'typescript'] as const) {
    const names = new Set(getDefaultApiMethodLibrary(lang).map((m) => m.methodName));
    for (const [verb, ct] of cases) {
      const picked = chooseSendMethod(verb, ct);
      assert.ok(names.has(picked), `${lang}: ${verb}/${ct ?? '-'} -> ${picked} must exist in the library`);
    }
  }
});
