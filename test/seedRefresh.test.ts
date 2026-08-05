import { test } from 'node:test';
import assert from 'node:assert';
import { refreshDefaults } from '../src/data/defaultLibraries';

interface Method { id?: string; methodName: string; code: string; isCustom?: boolean }

const curatedV2: Method[] = [
  { methodName: 'FirstName', code: 'return faker.Name.First(); // v2 fix', isCustom: false },
  { methodName: 'LastName', code: 'return faker.Name.Last();', isCustom: false },
];

// ── The SEED-1 point: a curated fix reaches an existing install ───────────────────────────────

test('an updated curated method body REPLACES the stale isCustom:false copy (id preserved)', () => {
  const existing: Method[] = [
    { id: 'x1', methodName: 'FirstName', code: 'return faker.Name.First(); // v1 stale', isCustom: false },
    { id: 'x2', methodName: 'LastName', code: 'return faker.Name.Last();', isCustom: false },
  ];
  const res = refreshDefaults(existing, curatedV2);
  const first = res.items.find(m => m.methodName === 'FirstName')!;
  assert.match(first.code, /v2 fix/, 'curated update must propagate to an existing install');
  assert.equal(first.id, 'x1', 'stored id must survive the replace (references)');
  assert.equal(res.replaced, 1, 'LastName is identical — only FirstName counts as replaced');
  assert.equal(res.changed, true);
});

test('a user-owned method (isCustom:true) is NEVER touched, even on a key match', () => {
  const existing: Method[] = [
    { id: 'u1', methodName: 'FirstName', code: 'return "my own version";', isCustom: true },
  ];
  const res = refreshDefaults(existing, curatedV2);
  const first = res.items.find(m => m.methodName === 'FirstName')!;
  assert.equal(first.code, 'return "my own version";', 'user-owned method must survive refresh');
  // The curated FirstName must NOT be appended as a duplicate either.
  assert.equal(res.items.filter(m => m.methodName === 'FirstName').length, 1);
});

test('user methods outside the curated set are untouched; new curated methods are appended', () => {
  const existing: Method[] = [
    { id: 'u1', methodName: 'MyCompanyToken', code: 'return "secret";', isCustom: true },
  ];
  const res = refreshDefaults(existing, curatedV2);
  assert.ok(res.items.find(m => m.methodName === 'MyCompanyToken'), 'user method must remain');
  assert.equal(res.added, 2, 'both curated methods are new here');
  assert.equal(res.items.length, 3);
});

test('missing isCustom counts as shipped (older installs predate the flag) -> replaced', () => {
  const existing: Method[] = [{ id: 'x1', methodName: 'FirstName', code: '// v1' }];
  const res = refreshDefaults(existing, curatedV2);
  assert.match(res.items.find(m => m.methodName === 'FirstName')!.code, /v2 fix/);
});

test('nothing differs -> changed:false so clients can skip the write', () => {
  const existing: Method[] = curatedV2.map((m, i) => ({ ...m, id: `x${i}` }));
  const res = refreshDefaults(existing, curatedV2);
  assert.equal(res.changed, false);
  assert.equal(res.replaced, 0);
  assert.equal(res.added, 0);
});

test('replacedItems/addedItems list exactly what a DB-backed client must persist', () => {
  const existing: Method[] = [
    { id: 'x1', methodName: 'FirstName', code: '// v1 stale', isCustom: false },
  ];
  const res = refreshDefaults(existing, curatedV2);
  assert.deepEqual(res.replacedItems.map(m => m.methodName), ['FirstName']);
  assert.equal(res.replacedItems[0].id, 'x1', 'replaced row keeps its id for the UPDATE');
  assert.deepEqual(res.addedItems.map(m => m.methodName), ['LastName']);
});

test('REFRESH-1: a curated RENAME replaces the old-named shipped copy via its stable id (no duplicate)', () => {
  // SEED-3 renamed GetDateStr -> DateStr keeping id 14. Name-only matching left the old copy AND
  // appended the new name — an existing install ended up with both.
  const curated: Method[] = [{ id: '14', methodName: 'DateStr', code: 'return today();', isCustom: false }];
  const existing: Method[] = [{ id: '14', methodName: 'GetDateStr', code: 'return today();', isCustom: false }];
  const res = refreshDefaults(existing, curated);
  assert.deepEqual(res.items.map(m => m.methodName), ['DateStr'], 'renamed in place — no GetDateStr+DateStr pair');
  assert.equal(res.replaced, 1);
  assert.equal(res.added, 0);
});

test('REFRESH-1: id match never overrides a user-owned method', () => {
  const curated: Method[] = [{ id: '14', methodName: 'DateStr', code: 'return today();', isCustom: false }];
  const existing: Method[] = [{ id: '14', methodName: 'MyThing', code: 'mine', isCustom: true }];
  const res = refreshDefaults(existing, curated);
  assert.equal(res.items.find(m => m.id === '14')!.code, 'mine', 'user method untouched');
  assert.deepEqual(res.addedItems.map(m => m.methodName), ['DateStr'], 'curated still appended — different method entirely');
});

test('order: existing order preserved; additions appended in curated order', () => {
  const existing: Method[] = [
    { id: 'x2', methodName: 'LastName', code: 'return faker.Name.Last();', isCustom: false },
    { id: 'u1', methodName: 'Mine', code: '// mine', isCustom: true },
  ];
  const res = refreshDefaults(existing, curatedV2);
  assert.deepEqual(res.items.map(m => m.methodName), ['LastName', 'Mine', 'FirstName']);
});
