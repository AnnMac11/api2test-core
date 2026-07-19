/**
 * Characterization tests for the E2E case-builder rules. These lock the current behaviour of the
 * composition logic that was extracted out of E2ETestCaseDialog so the dialog can be refactored
 * without silently changing how test cases validate or how variables/placeholders resolve.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  paramsOf, placeholdersOf, takesUrlTemplate, takesFieldPath,
  isConsumedClass, sourceEndpointKey, availableVarsBefore, validateSteps,
  isSendMethod, friendlyMethodName, groupIntoCalls, stepIncomplete,
  type MethodParamMap, type PickerLike,
} from '../src/services/e2eCaseLogic';
import type { E2ECaseItem } from '../src/models/E2EDto';

const methodParams: MethodParamMap = {
  PostJsonAsync: 'token:string, url:string, jsonBody:string',
  GetByIdAsync: 'token:string, urlTemplate:string, value:string',
  ExtractFieldFromResponse: 'response:string, fieldPath:string',
  PlainMethod: 'token:string, name:string',
};
const classItems: PickerLike[] = [
  { value: 'StripeCustomer', sub: '/v1/customers (POST)', meta: 'application/x-www-form-urlencoded' },
  { value: 'GetCustomer', sub: '/v1/customers/{id} (GET)' },
];
const M = (ref: string, extra: Partial<E2ECaseItem> = {}): E2ECaseItem => ({ type: 'Method', ref, ...extra });
const C = (ref: string, extra: Partial<E2ECaseItem> = {}): E2ECaseItem => ({ type: 'Class', ref, ...extra });

test('paramsOf splits the parameter string and tolerates unknown methods', () => {
  assert.deepEqual(paramsOf(methodParams, 'PostJsonAsync'), ['token', 'url', 'jsonBody']);
  assert.deepEqual(paramsOf(methodParams, 'Nope'), []);
});

test('placeholdersOf extracts {tokens} from the class endpoint', () => {
  assert.deepEqual(placeholdersOf(classItems, 'GetCustomer'), ['id']);
  assert.deepEqual(placeholdersOf(classItems, 'StripeCustomer'), []);
});

test('takesUrlTemplate / takesFieldPath classify methods', () => {
  assert.equal(takesUrlTemplate(methodParams, 'GetByIdAsync'), true);
  assert.equal(takesUrlTemplate(methodParams, 'PostJsonAsync'), false);
  assert.equal(takesFieldPath(methodParams, 'ExtractFieldFromResponse'), true);
  assert.equal(takesFieldPath(methodParams, 'PlainMethod'), false);
});

test('isConsumedClass is true only when a url-taking method sits directly above', () => {
  const items = [M('PostJsonAsync'), C('StripeCustomer')];
  assert.equal(isConsumedClass(items, methodParams, 1), true);
  assert.equal(isConsumedClass([C('StripeCustomer')], methodParams, 0), false);
  assert.equal(isConsumedClass([M('PlainMethod'), C('StripeCustomer')], methodParams, 1), false);
});

test('sourceEndpointKey finds the nearest class above and parses METHOD', () => {
  const items = [C('GetCustomer'), M('ExtractFieldFromResponse')];
  assert.deepEqual(sourceEndpointKey(items, classItems, 1), {
    key: 'GET /v1/customers/{id}', endpoint: '/v1/customers/{id}', method: 'GET',
  });
  assert.equal(sourceEndpointKey([M('ExtractFieldFromResponse')], classItems, 0), null);
});

test('availableVarsBefore lists default + assigned + captured names, deduped', () => {
  const items = [
    C('StripeCustomer', { capture: { fieldPath: 'id', variable: 'custId' } }),
    M('PlainMethod', { assignTo: 'myVar' }),
  ];
  assert.deepEqual(availableVarsBefore(items, 2), ['response1', 'custId', 'myVar']);
});

test('validateSteps: a valid send-then-class case passes', () => {
  const items = [M('PostJsonAsync'), C('StripeCustomer')];
  assert.equal(validateSteps(items, methodParams, classItems), null);
});

test('validateSteps: consumed class with an unbound {placeholder} fails', () => {
  const items = [M('PostJsonAsync'), C('GetCustomer')];
  assert.match(validateSteps(items, methodParams, classItems)!, /URL placeholder \{id\}/);
});

test('validateSteps: a url method without a class below fails', () => {
  assert.match(validateSteps([M('PostJsonAsync')], methodParams, classItems)!, /needs a class step directly below/);
});

test('validateSteps: a missing required arg fails', () => {
  assert.match(validateSteps([M('PlainMethod')], methodParams, classItems)!, /needs "name" set/);
});

test('validateSteps: an extract step without assignTo fails', () => {
  // Bind the class {id} so the class step is valid and validation reaches the extract step (the
  // class-first rule now fails an unbound-placeholder class first — see the standalone-class test).
  const items = [
    C('GetCustomer', { args: { id: { value: 'cus_1' } } }),
    M('ExtractFieldFromResponse', { args: { fieldPath: { value: 'id' } } }),
  ];
  assert.match(validateSteps(items, methodParams, classItems)!, /needs a variable name/);
});

test('validateSteps: duplicate assigned variable names fail', () => {
  const items = [
    M('PlainMethod', { assignTo: 'x', args: { name: { value: 'a' } } }),
    M('PlainMethod', { assignTo: 'x', args: { name: { value: 'b' } } }),
  ];
  assert.match(validateSteps(items, methodParams, classItems)!, /assigned more than once/);
});

// --- E2E-GROUP-1: class-first grouping lifted from Desktop (2026-07-19) ---

test('isSendMethod: true only for url/urlTemplate-taking wrappers', () => {
  assert.equal(isSendMethod(methodParams, 'PostJsonAsync'), true);
  assert.equal(isSendMethod(methodParams, 'GetByIdAsync'), true);
  assert.equal(isSendMethod(methodParams, 'ExtractFieldFromResponse'), false);
  assert.equal(isSendMethod(methodParams, 'PlainMethod'), false);
});

test('friendlyMethodName: maps known labels, strips suffixes otherwise', () => {
  assert.equal(friendlyMethodName('ExtractFieldFromResponse'), 'ExtractField');
  assert.equal(friendlyMethodName('ValidateBadRequestResponseAsync'), 'Validate 400');
  assert.equal(friendlyMethodName('SomethingCustomAsync'), 'SomethingCustom');
});

test('groupIntoCalls: send row + class-led row, each with attached follow-ups', () => {
  // send → class → extract | class(-led) → plain-method(follow)
  const items = [
    M('PostJsonAsync'), C('StripeCustomer'), M('ExtractFieldFromResponse'),
    C('GetCustomer'), M('PlainMethod'),
  ];
  assert.deepEqual(groupIntoCalls(items, methodParams), [
    { sendIdx: 0, classIdx: 1, followIdxs: [2], allIdxs: [0, 1, 2] },
    { sendIdx: null, classIdx: 3, followIdxs: [4], allIdxs: [3, 4] },
  ]);
});

test('groupIntoCalls: a lone non-send method is its own orphan row', () => {
  assert.deepEqual(groupIntoCalls([M('ExtractFieldFromResponse')], methodParams), [
    { sendIdx: null, classIdx: null, followIdxs: [0], allIdxs: [0] },
  ]);
});

test('stepIncomplete: class with an unbound {placeholder} is incomplete until set', () => {
  assert.equal(stepIncomplete([C('GetCustomer')], methodParams, classItems, 0), true);
  const bound = [C('GetCustomer', { args: { id: { value: 'cus_1' } } })];
  assert.equal(stepIncomplete(bound, methodParams, classItems, 0), false);
});

// Reconciled drift (E2E-GROUP-1): the class IS the call, so a class with a {placeholder} always
// needs it bound — NOT only when a send method sits above it (core's old `isConsumedClass` gate).
// FAILS on the pre-lift code (a standalone class returned null / passed).
test('validateSteps: standalone class with an unbound {placeholder} fails (class-first)', () => {
  assert.match(
    validateSteps([C('GetCustomer')], methodParams, classItems)!,
    /needs a value for the URL placeholder \{id\}/,
  );
});
