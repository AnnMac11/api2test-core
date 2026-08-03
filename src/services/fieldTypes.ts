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
