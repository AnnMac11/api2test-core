/**
 * PY-GEN-1 — naming rules the Python emitters share (parallel to tsNaming.ts).
 *
 * The registry stores PascalCase method names (`PostJsonAsync`, `PetStoreBaseUrl`); the Python seed
 * defines snake_case symbols. Unlike {@link tsSymbol} (which drops the trailing `Async`), Python keeps
 * it as `_async` — that is how the curated seed spells its functions (`post_json_async`), and dropping
 * it would collide `Get` with `GetAsync`.
 */

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** PascalCase/camelCase → snake_case: `ValidateSuccess_200_201Async` → `validate_success_200_201_async`. */
export function pySymbol(name: string): string {
  const s = (name || '').trim();
  if (!s) { return s; }
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase();
}

/** True when `name` can be used as `obj.name` / `self.name` (identifier and not a keyword). */
export function isPyIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name);
}
