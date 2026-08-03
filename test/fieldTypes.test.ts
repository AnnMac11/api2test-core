import { test } from 'node:test';
import assert from 'node:assert';
import { fieldDisplayType } from '../src/services/fieldTypes';

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
