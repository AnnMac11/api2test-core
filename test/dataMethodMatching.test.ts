import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  orderDataMethodsForField, sortDataMethodsByName, dataMethodKindLabel, typeClass,
} from '../src/services/dataMethodMatching';

// A small library covering every coarse kind (object / array / scalar), deliberately in a NON-sorted,
// NON-grouped stored order — mirrors what the client used to hand straight to the dropdown.
const library = [
  { methodName: 'RandomZip', returnType: 'string' },
  { methodName: 'RandomAddress', returnType: 'object' },
  { methodName: 'RandomTags', returnType: 'List<string>' },
  { methodName: 'RandomAge', returnType: 'int' },
  { methodName: 'RandomCompany', returnType: 'object' },
  { methodName: 'RandomEmail', returnType: 'string' },
];

test('RB-1: an object field surfaces object methods first (A–Z), then everything else — nothing dropped', () => {
  const ordered = orderDataMethodsForField('object', library);

  // Every stored method is still reachable (the mis-classified one stays selectable).
  assert.equal(ordered.length, library.length);

  // The MATCHING group (object methods) comes first, sorted A–Z...
  const matchingValues = ordered.filter(o => o.matches).map(o => o.value);
  assert.deepEqual(matchingValues, ['RandomAddress', 'RandomCompany']);

  // ...and it is a strict prefix of the list — no non-matching method appears above a matching one.
  const firstNonMatch = ordered.findIndex(o => !o.matches);
  assert.deepEqual(
    ordered.slice(0, firstNonMatch).map(o => o.value),
    ['RandomAddress', 'RandomCompany'],
    'object methods must be the top block',
  );

  // THE BUG THIS PINS: the old dropdown showed stored order, so the first entry was the scalar
  // RandomZip, not a matching object method. Matching-first must reorder that.
  assert.equal(ordered[0].value, 'RandomAddress');
  assert.notEqual(ordered[0].value, library[0].methodName);
});

test('RB-1: labels are `Name (kind)` — objects/arrays show the word, scalars show the concrete type', () => {
  const ordered = orderDataMethodsForField('object', library);
  const label = (v: string) => ordered.find(o => o.value === v)!.label;
  assert.equal(label('RandomAddress'), 'RandomAddress (object)');
  assert.equal(label('RandomTags'), 'RandomTags (array)');
  assert.equal(label('RandomZip'), 'RandomZip (string)');
  assert.equal(label('RandomAge'), 'RandomAge (int)');
});

test('RB-1: a scalar field groups all scalars on top, objects/arrays below', () => {
  const ordered = orderDataMethodsForField('int', library);
  const matching = ordered.filter(o => o.matches).map(o => o.value);
  // string + int methods are all "scalar" — they match a scalar field; objects/arrays do not.
  assert.deepEqual(matching, ['RandomAge', 'RandomEmail', 'RandomZip']);
  assert.deepEqual(
    ordered.filter(o => !o.matches).map(o => o.value),
    ['RandomAddress', 'RandomCompany', 'RandomTags'],
  );
});

test('RB-1: input array is not mutated', () => {
  const snapshot = library.map(m => m.methodName);
  orderDataMethodsForField('object', library);
  assert.deepEqual(library.map(m => m.methodName), snapshot);
});

test('RB-3: sortDataMethodsByName sorts A–Z case-insensitively, returning a copy', () => {
  const stored = [{ methodName: 'Zebra' }, { methodName: 'apple' }, { methodName: 'Mango' }];
  const sorted = sortDataMethodsByName(stored);
  assert.deepEqual(sorted.map(m => m.methodName), ['apple', 'Mango', 'Zebra']);
  // Not mutated — stored order is a source of truth elsewhere.
  assert.deepEqual(stored.map(m => m.methodName), ['Zebra', 'apple', 'Mango']);
});

test('typeClass keeps numeric fields off string generators (the classifier DataDictionary shares)', () => {
  assert.equal(typeClass('decimal'), 'number');
  assert.equal(typeClass('long'), 'number');
  assert.equal(typeClass('List<string>'), 'array');
  assert.equal(typeClass('object'), 'object');
  assert.equal(dataMethodKindLabel('Guid'), 'Guid');
});
