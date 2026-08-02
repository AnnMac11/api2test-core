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

/**
 * The TypeScript PROPERTY key a spec field is generated as: the **exact JSON key**, quoted when it is
 * not a valid JS identifier (`pet-id` -> `'pet-id'`, `email` -> `email`).
 *
 * Unlike C#, generated TS keeps the raw field name — the property name *is* the JSON key, so there is
 * no `[JsonPropertyName]`. Single source of truth (OVR-CASE, TS half): the request-class emitter and the
 * E2E object-initializer that pins a field per test must agree on the quoting, or the initializer emits
 * `{ pet-id: … }` against a class declaring `'pet-id'` — a syntax error. C# counterpart: `csPropertyName`.
 */
export function tsPropKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`;
}
