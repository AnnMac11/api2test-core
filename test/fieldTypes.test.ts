import { test } from 'node:test';
import assert from 'node:assert';
import { captureTypes, fieldDisplayType } from '../src/services/fieldTypes';
import { mapCaptureType } from '../src/services/e2eCaseLogic';

/**
 * TYPE-1 step 2 — one stored-type → declared-type map, so a client can show the user the type the
 * generated code will actually declare instead of copying a fourth private switch.
 */

test('a stored type maps to what each language declares', () => {
  const cases: Array<[string, string, string, string]> = [
    // stored        C#          TypeScript   Python
    ['string',      'string',   'string',    'str'],
    ['integer',     'int',      'number',    'int'],
    ['number',      'decimal',  'number',    'float'],
    ['boolean',     'bool',     'boolean',   'bool'],
    ['date',        'DateTime', 'string',    'str'],
    ['object',      'object',   'unknown',   'Any'],
    ['array',       'object',   'unknown',   'Any'],
  ];
  for (const [stored, cs, ts, py] of cases) {
    assert.strictEqual(fieldDisplayType(stored, 'csharp'), cs, `${stored} → C#`);
    assert.strictEqual(fieldDisplayType(stored, 'typescript'), ts, `${stored} → TS`);
    assert.strictEqual(fieldDisplayType(stored, 'python'), py, `${stored} → Python`);
  }
});

test('integer stays an integer — it must not collapse into the decimal branch', () => {
  // The CS0266 chain came from an id typed too wide. `integer` and `number` are kept apart on purpose
  // (core #52), and this is the map that has to preserve that.
  assert.strictEqual(fieldDisplayType('integer', 'csharp'), 'int');
  assert.strictEqual(fieldDisplayType('number', 'csharp'), 'decimal');
});

test('a type already written in the language is recognised, not mangled', () => {
  assert.strictEqual(fieldDisplayType('int', 'csharp'), 'int');
  assert.strictEqual(fieldDisplayType('decimal', 'csharp'), 'decimal');
  assert.strictEqual(fieldDisplayType('Guid', 'csharp'), 'Guid');
  assert.strictEqual(fieldDisplayType('bool', 'csharp'), 'bool');
});

test('unknown or missing falls back to string, as every generator already did', () => {
  assert.strictEqual(fieldDisplayType('Pet', 'csharp'), 'string');
  assert.strictEqual(fieldDisplayType(undefined, 'csharp'), 'string');
  assert.strictEqual(fieldDisplayType('', 'typescript'), 'string');
  assert.strictEqual(fieldDisplayType(undefined, 'python'), 'str');
});

/**
 * CAP-TYPE (user, 2026-08-03): *"as we are working in C# I would like to see all the C# type options in
 * the dropdown"*. The store-as picker offered one abstract list — `string / number / bool / Guid` — so a
 * user chaining an id into an `int?` field had no `int` to pick and had to trust that something else
 * would fix it up. The picker now offers the types of the language the workspace is locked to.
 */
test('CAP-TYPE: the store-as picker offers the chosen language\'s own types', () => {
  assert.deepStrictEqual(captureTypes('csharp'),
    ['string', 'int', 'long', 'decimal', 'double', 'bool', 'Guid', 'DateTime']);
  assert.deepStrictEqual(captureTypes('typescript'), ['string', 'number', 'boolean']);
  assert.deepStrictEqual(captureTypes('python'), ['str', 'int', 'float', 'bool']);
});

test('CAP-TYPE: every offered type survives the capture mapping unchanged', () => {
  // The picker is only honest if what it offers is what gets declared: `int` must emit
  // `ExtractFields<int>`, not be re-mapped into something wider.
  for (const t of captureTypes('csharp')) {
    assert.strictEqual(mapCaptureType(t, 'csharp'), t, `${t} must reach the generated code as itself`);
  }
  for (const t of captureTypes('typescript')) {
    assert.strictEqual(mapCaptureType(t, 'typescript'), t, `${t} must reach the generated code as itself`);
  }
});

test('CAP-TYPE: a case saved under the old abstract list still generates', () => {
  // Existing test cases hold `number` / `bool` / `Guid`. They are no longer offered, but they must keep
  // mapping to the same C# types they always did.
  assert.strictEqual(mapCaptureType('number', 'csharp'), 'decimal');
  assert.strictEqual(mapCaptureType('bool', 'csharp'), 'bool');
  assert.strictEqual(mapCaptureType('Guid', 'csharp'), 'Guid');
});
