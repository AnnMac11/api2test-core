import { test } from 'node:test';
import assert from 'node:assert';
import { chooseSendMethod, chooseExtractMethod, isFormEncoded } from '../src/services/e2eMethodSelection';
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
  assert.equal(chooseExtractMethod('id', 'GET'), 'ExtractFieldFromResponse');
  assert.equal(chooseExtractMethod('data.token', 'POST'), 'ExtractFieldFromResponse');
  assert.equal(chooseExtractMethod('  status  ', 'DELETE'), 'ExtractFieldFromResponse');
});

test('chooseExtractMethod validates by verb when NO response field is selected', () => {
  // DELETE passes on 200/204; every other verb (GET 200, POST 201, PUT, PATCH) on 200/201.
  assert.equal(chooseExtractMethod(undefined, 'DELETE'), 'ValidateDeleteResponseAsync');
  assert.equal(chooseExtractMethod('', 'delete'), 'ValidateDeleteResponseAsync'); // case tolerant
  assert.equal(chooseExtractMethod(undefined, 'GET'), 'ValidateResponseAsync');
  assert.equal(chooseExtractMethod('', 'POST'), 'ValidateResponseAsync');
  assert.equal(chooseExtractMethod('   ', 'PUT'), 'ValidateResponseAsync'); // whitespace-only = no field
  assert.equal(chooseExtractMethod(undefined, undefined), 'ValidateResponseAsync');
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
