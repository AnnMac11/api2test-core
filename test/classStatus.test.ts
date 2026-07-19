/**
 * CLS-3 — the RAG roll-up / result rule, lifted from Desktop `statusColours.ts`. These pin the truth
 * table that drives the class-status column and the test-case impact cascade shared by both editions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollupRag, resultToRag } from '../src/services/classStatus';

test('rollupRag: any red wins', () => {
  assert.equal(rollupRag(['green', 'red', 'grey']), 'red');
  assert.equal(rollupRag(['red']), 'red');
});

test('rollupRag: all green → green; all grey → grey', () => {
  assert.equal(rollupRag(['green', 'green']), 'green');
  assert.equal(rollupRag(['grey', 'grey']), 'grey');
});

test('rollupRag: a mix without red → amber', () => {
  assert.equal(rollupRag(['green', 'grey']), 'amber');
  assert.equal(rollupRag(['green', 'amber']), 'amber');
  assert.equal(rollupRag(['amber', 'grey']), 'amber');
});

test('rollupRag: empty → grey', () => {
  assert.equal(rollupRag([]), 'grey');
});

test('resultToRag: pass→green, fail→red, skip→amber, else grey', () => {
  assert.equal(resultToRag('pass'), 'green');
  assert.equal(resultToRag('fail'), 'red');
  assert.equal(resultToRag('skip'), 'amber');
  assert.equal(resultToRag('nonsense'), 'grey');
});
