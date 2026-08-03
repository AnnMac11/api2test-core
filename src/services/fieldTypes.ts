import { TargetLanguage } from '../adapters/CodeEmitter';

/**
 * The **one** map from a stored field type to the type the generated code declares (TYPE-1 step 2).
 *
 * Fields are stored with an abstract type — `string` / `integer` / `number` / `boolean` / `date` /
 * `object` / `array` — taken from the spec by the Data Dictionary. What a user actually needs to see,
 * and what the generator must emit, is the *concrete* type for the language they chose: `int` in C#,
 * `number` in TypeScript, `int` in Python.
 *
 * Before this, each generator carried its own private switch (`getCSharpType`, `tsType`), so the UI had
 * no way to show the type at all without copying a third one — and Python would have made a fourth.
 * They now delegate here, which is what makes the type on screen and the type in the file the same
 * thing by construction.
 *
 * The common concrete types are recognised as well as the abstract ones (`int`, `decimal`, `bool`,
 * `DateTime`, `Guid`), so a stored value that is already language-specific still maps correctly. Anything
 * unrecognised falls back to string — the default every generator already used, kept deliberately so
 * delegating here changes no generated code.
 *
 * The language is fixed at install and cannot be changed afterwards (user, 2026-08-03), so a concrete
 * type may be stored as well as displayed — there is no later switch to invalidate it.
 */
export function fieldDisplayType(type: string | undefined, language: TargetLanguage): string {
  const t = (type || '').trim();
  switch (t.toLowerCase()) {
    case 'string': case 'text': case 'email': case 'url':
      return language === 'python' ? 'str' : 'string';
    case 'int': case 'integer':
      return language === 'csharp' ? 'int' : language === 'python' ? 'int' : 'number';
    case 'decimal': case 'number': case 'double': case 'float':
      // C# `decimal` (not double) so money and large ids stay exact; Python `float` matches the spec's
      // `number`, and `integer` above keeps its own branch so an id does not become a float.
      return language === 'csharp' ? 'decimal' : language === 'python' ? 'float' : 'number';
    case 'bool': case 'boolean':
      return language === 'csharp' ? 'bool' : language === 'python' ? 'bool' : 'boolean';
    case 'guid': case 'uuid':
      // Only C# has a first-class type for it.
      return language === 'csharp' ? 'Guid' : language === 'python' ? 'str' : 'string';
    case 'datetime': case 'date':
      return language === 'csharp' ? 'DateTime' : language === 'python' ? 'str' : 'string';
    // object/array hold whatever the assigned data method returns, so they are declared as the widest
    // type the language has that still serialises correctly.
    case 'object': case 'array':
      return language === 'csharp' ? 'object' : language === 'python' ? 'Any' : 'unknown';
    // Unknown/absent → string, the safe default every generator already used.
    default:
      return language === 'python' ? 'str' : 'string';
  }
}

/**
 * The types a client offers in the OUT row's "store as" picker, for the language the workspace is
 * locked to (CAP-TYPE).
 *
 * It used to be one abstract list — `string / number / bool / Guid` — mapped to the language on the way
 * out. That hid the only thing the user is actually choosing: a C# workspace chaining an id into an
 * `int?` field had no `int` to pick, only `number` (→ `decimal`). The generator now takes the
 * destination field's type where there is one, but the picker still has to be honest about what it
 * stores when nothing constrains it.
 *
 * These are concrete types, so they pass through `mapCaptureType` untouched — what is picked is what is
 * declared. The old abstract values still map as they always did, so saved cases keep generating.
 *
 * Order is deliberate: the common pick first, then widening. Not every language type is here — this is
 * the set that a value read out of a JSON response can sensibly be stored as.
 */
export function captureTypes(language: TargetLanguage): string[] {
  switch (language) {
    case 'csharp':
      return ['string', 'int', 'long', 'decimal', 'double', 'bool', 'Guid', 'DateTime'];
    case 'python':
      return ['str', 'int', 'float', 'bool'];
    default:
      return ['string', 'number', 'boolean'];
  }
}
