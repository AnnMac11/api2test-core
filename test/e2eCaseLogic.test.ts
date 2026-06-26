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
  const items = [C('GetCustomer'), M('ExtractFieldFromResponse', { args: { fieldPath: { value: 'id' } } })];
  assert.match(validateSteps(items, methodParams, classItems)!, /needs a variable name/);
});

test('validateSteps: duplicate assigned variable names fail', () => {
  const items = [
    M('PlainMethod', { assignTo: 'x', args: { name: { value: 'a' } } }),
    M('PlainMethod', { assignTo: 'x', args: { name: { value: 'b' } } }),
  ];
  assert.match(validateSteps(items, methodParams, classItems)!, /assigned more than once/);
});
