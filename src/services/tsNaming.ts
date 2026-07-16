/**
 * Registry method names are the cross-language key and are PascalCase, often with a C#-style `Async`
 * suffix (`FirstName`, `PostJsonAsync`, `GetAsync`). Generated TypeScript should read like TypeScript,
 * so the TS emitters call methods by their idiomatic symbol instead of the raw registry name.
 *
 * `tsSymbol` is the single source of truth for that PascalCase→camelCase mapping — used by BOTH the
 * emitters (when they emit a call) and the TS seed library (whose `code` defines the symbol). They must
 * agree, so both go through this one function.
 *
 * Rule: drop a trailing `Async` (TS async functions don't carry it), then lower-case the first letter.
 *   FirstName → firstName · PostJsonAsync → postJson · GetAsync → get · ExtractFieldFromResponse → extractFieldFromResponse
 */
export function tsSymbol(name: string): string {
  const stripped = (name || '').replace(/Async$/, '');
  if (!stripped) { return stripped; }
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}
