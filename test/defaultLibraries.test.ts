import { test } from 'node:test';
import assert from 'node:assert';
import {
  getDefaultDataLibrary,
  getDefaultApiMethodLibrary,
  mergeDefaults,
} from '../src/data/defaultLibraries';

test('csharp libraries return the canonical built-in sets', () => {
  assert.equal(getDefaultDataLibrary('csharp').length, 93);
  assert.equal(getDefaultApiMethodLibrary('csharp').length, 18);
});

test('csharp wrapper library uses the names the generators emit', () => {
  const names = new Set(getDefaultApiMethodLibrary('csharp').map((m) => m.methodName));
  for (const expected of ['PostJsonAsync', 'PostFormAsync', 'PostMultipartAsync', 'GetAsync']) {
    assert.ok(names.has(expected), `expected wrapper ${expected}`);
  }
});

test('accessors hand out fresh copies (mutation does not leak)', () => {
  const a = getDefaultDataLibrary('csharp');
  a.pop();
  assert.equal(getDefaultDataLibrary('csharp').length, 93);
});

test('python libraries mirror the csharp set (same methods, Python bodies)', () => {
  const py = getDefaultDataLibrary('python');
  const cs = getDefaultDataLibrary('csharp');
  assert.equal(py.length, 93);
  assert.equal(getDefaultApiMethodLibrary('python').length, 18);
  // same methodNames (auto-matching parity), but Python code bodies
  assert.deepEqual(py.map((m) => m.methodName).sort(), cs.map((m) => m.methodName).sort());
  const firstName = py.find((m) => m.methodName === 'FirstName')!;
  assert.match(firstName.code, /def first_name\(self\)/);
  assert.match(firstName.code, /self\._fake\.first_name\(\)/);
});

test('mergeDefaults adds missing defaults and preserves user items', () => {
  const userCustom = { methodName: 'MyCustomThing', code: 'x' };
  const existing = [userCustom, { methodName: 'FirstName' }];
  const merged = mergeDefaults(existing, getDefaultDataLibrary('csharp'));
  // user's custom method survives, FirstName is not duplicated, the rest are added
  assert.ok(merged.includes(userCustom), 'user custom preserved');
  assert.equal(merged.filter((m: any) => m.methodName === 'FirstName').length, 1, 'no duplicate');
  assert.equal(merged.length, 93 + 1, 'all defaults present plus the one custom');
});

test('mergeDefaults returns the same array when nothing is missing', () => {
  const defaults = getDefaultDataLibrary('csharp');
  const merged = mergeDefaults(defaults, defaults);
  assert.equal(merged.length, 93);
});
