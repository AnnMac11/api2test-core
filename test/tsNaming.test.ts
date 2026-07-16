/**
 * The PascalCase→camelCase mapping the TS emitters and the TS seed library share (so generated TS reads
 * like TS). Drop a trailing `Async`, then lower-case the first letter.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { tsSymbol } from '../src/services/tsNaming';

test('tsSymbol maps registry names to idiomatic TS symbols', () => {
  assert.equal(tsSymbol('FirstName'), 'firstName');
  assert.equal(tsSymbol('PostJsonAsync'), 'postJson');
  assert.equal(tsSymbol('GetAsync'), 'get');
  assert.equal(tsSymbol('DeleteAsync'), 'delete');
  assert.equal(tsSymbol('ExtractFieldFromResponse'), 'extractFieldFromResponse');
  // Already-idiomatic names pass through unchanged.
  assert.equal(tsSymbol('email'), 'email');
  assert.equal(tsSymbol('randomId'), 'randomId');
  assert.equal(tsSymbol(''), '');
});
