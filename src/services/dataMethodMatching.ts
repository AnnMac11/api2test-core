/**
 * Data-method ↔ field-type matching — pure, edition-neutral helpers shared by the Data Dictionary UI in
 * both editions (VS Code webview + Desktop React). Historically each client re-implemented its own coarse
 * "kind" classifier for the inline data-method dropdown (VS Code's `getDataMethodOptions.kind()`), drifting
 * from core's real `typeClass`. This is the single source: classify a type, and order the library methods
 * for a given field so the ones that fit come first.
 *
 * RB-1 (VS Code) / the matching Desktop lift: the inline dropdown filters to methods whose return kind
 * matches the field's type, keeps a return-type label, and still lists every method so a mis-classified one
 * stays reachable — implemented here as "matching first, all others below", labelled `MethodName (kind)`.
 */

/** Fine type class used by field↔method matching (mirrors the six data-generation shapes). */
export type TypeClass = 'object' | 'array' | 'number' | 'boolean' | 'date' | 'string';

/**
 * Classify a C#/JSON type name into one of the six data-generation shapes. Tolerant of nullable (`int?`),
 * collections (`List<T>`, `T[]`, `array`), maps (`Dictionary`, `object`) and the scalar spellings.
 */
export function typeClass(type: string): TypeClass {
    const t = (type || '').toLowerCase().trim().replace(/\?/g, '');
    if (t.includes('list<') || t.endsWith('[]') || t === 'array') { return 'array'; }
    if (t.includes('dictionary') || t === 'object') { return 'object'; }
    if (/^(number|integer|int|long|short|byte|sbyte|uint|ulong|ushort|decimal|double|float|single)$/.test(t)) { return 'number'; }
    if (t === 'bool' || t === 'boolean') { return 'boolean'; }
    if (t === 'date' || t === 'dateonly' || t === 'timespan' || t.includes('datetime')) { return 'date'; }
    return 'string';
}

/**
 * RB-3: order data-library methods A–Z by name for display (locale-aware, case-insensitive). Returns a
 * sorted COPY — the stored order is a source of truth elsewhere and must stay untouched. Shared so the
 * Data Library grid orders identically in both editions.
 */
export function sortDataMethodsByName<T extends { methodName?: string }>(methods: T[]): T[] {
    return [...methods].sort((a, b) =>
        (a.methodName || '').localeCompare(b.methodName || '', undefined, { sensitivity: 'base' }));
}

/** Coarse kind the dropdown groups by — object / array / scalar (every non-object, non-array type). */
export type CoarseKind = 'object' | 'array' | 'scalar';
export function coarseKind(type: string): CoarseKind {
    const c = typeClass(type);
    return c === 'object' || c === 'array' ? c : 'scalar';
}

/**
 * The bracket label shown after the method name, e.g. `RandomAddress (object)`. Objects and arrays show
 * that word; scalars show their concrete return type (`string`, `int`, `decimal`) so it stays informative.
 */
export function dataMethodKindLabel(returnType: string): string {
    const c = typeClass(returnType);
    if (c === 'object') { return 'object'; }
    if (c === 'array') { return 'array'; }
    return returnType || 'string';
}

/** One ordered dropdown entry. `value` is the bare method name (unchanged); `label` is `Name (kind)`. */
export interface DataMethodOption {
    value: string;
    label: string;
    /** Coarse kind of the method's return type — lets a client group/optgroup the list. */
    kind: CoarseKind;
    /** True when the method's kind matches the field's type kind (the "matching" group). */
    matches: boolean;
}

/**
 * Order a field's data-method options: the methods whose kind matches the field's type first (so an
 * `object` field surfaces object methods, an `array` field arrays, a scalar field scalars), then every
 * other method underneath — nothing is hidden, so a mis-classified method is still selectable. Within each
 * group methods are sorted A–Z by name. Pure: the input array is not mutated.
 */
export function orderDataMethodsForField<T extends { methodName?: string; returnType?: string }>(
    fieldType: string,
    methods: T[],
): DataMethodOption[] {
    const fieldKind = coarseKind(fieldType);
    const byName = (a: T, b: T) =>
        (a.methodName || '').localeCompare(b.methodName || '', undefined, { sensitivity: 'base' });
    const toOption = (m: T): DataMethodOption => ({
        value: m.methodName || '',
        label: `${m.methodName || ''} (${dataMethodKindLabel(m.returnType || '')})`,
        kind: coarseKind(m.returnType || ''),
        matches: coarseKind(m.returnType || '') === fieldKind,
    });
    const named = methods.filter(m => m.methodName);
    const matching = named.filter(m => coarseKind(m.returnType || '') === fieldKind).sort(byName).map(toOption);
    const others = named.filter(m => coarseKind(m.returnType || '') !== fieldKind).sort(byName).map(toOption);
    return [...matching, ...others];
}
