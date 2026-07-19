/**
 * E2E-RESP (core half): make API response data selectable in the E2E builder.
 *
 * `responseFields` flattens a response example into dotted field paths (`id`, `address.city`) so the
 * builder can offer them in a dropdown instead of a raw text box. Edition-neutral and pure — the
 * store lookup / spec re-parse / HTTP stay in the client (Desktop's `api/e2e/response-fields` route,
 * VS Code's `responseExamples` read). Lifted from Desktop's local `flatten`, kept byte-behaviour
 * identical (objects up to 2 levels deep, arrays not descended), with tolerant input added.
 */

/** Objects up to 2 levels deep are descended; arrays are never descended. */
function flatten(obj: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, p, depth + 1, out);
  }
  return out;
}

/**
 * Dotted field paths for a response example. Accepts a parsed object OR a JSON string (both editions
 * store it differently). Returns de-duplicated paths, or `[]` for a primitive / array / invalid JSON —
 * never throws, so a caller can wire it straight to a dropdown.
 */
export function responseFields(example: unknown): string[] {
  let value = example;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return [...new Set(flatten(value))];
}
