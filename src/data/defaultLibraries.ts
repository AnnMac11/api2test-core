/**
 * Canonical curated libraries — the single source of truth for the built-in Data Library
 * (data-generation methods) and API Method Library (HTTP wrappers + base-path/token helpers).
 *
 * Every edition (VS Code extension, enterprise app, Jira app) seeds from these instead of keeping
 * its own copy, so a method added here reaches all of them. Keyed by target language because the
 * method bodies are language-specific (C# today; Python placeholder until a PythonEmitter lands).
 *
 * Seeding is copy-if-missing + {@link mergeDefaults}: a fresh install gets the full set; an existing
 * install gets any newly-shipped methods merged in without overwriting the user's own additions.
 */
import type { DataMethodDto } from '../models/DataMethodDto';
import type { ApiMethodLibraryDto } from '../models/ApiMethodDto';
import type { TargetLanguage } from '../adapters/CodeEmitter';

import csharpDataLibrary from './libraries/csharp/data-library.json';
import csharpApiMethodLibrary from './libraries/csharp/api-method-library.json';
import pythonDataLibrary from './libraries/python/data-library.json';
import pythonApiMethodLibrary from './libraries/python/api-method-library.json';
import typescriptDataLibrary from './libraries/typescript/data-library.json';
import typescriptApiMethodLibrary from './libraries/typescript/api-method-library.json';

// Partial: not every TargetLanguage has a curated seed set. C#, Python and TypeScript are seeded; the
// TS data set is a core subset (long tail tracked in TASKS.md TS-C8). getDefault* falls back to [].
const DATA_LIBRARIES: Partial<Record<TargetLanguage, unknown>> = {
  csharp: csharpDataLibrary,
  python: pythonDataLibrary,
  typescript: typescriptDataLibrary,
};
const API_METHOD_LIBRARIES: Partial<Record<TargetLanguage, unknown>> = {
  csharp: csharpApiMethodLibrary,
  python: pythonApiMethodLibrary,
  typescript: typescriptApiMethodLibrary,
};

/** The built-in data-generation methods for a target language (fresh copy, safe to mutate). */
export function getDefaultDataLibrary(language: TargetLanguage = 'csharp'): DataMethodDto[] {
  return structuredCloneArray((DATA_LIBRARIES[language] ?? []) as DataMethodDto[]);
}

/** The built-in HTTP wrapper / base-path / token methods for a target language (fresh copy). */
export function getDefaultApiMethodLibrary(language: TargetLanguage = 'csharp'): ApiMethodLibraryDto[] {
  return structuredCloneArray((API_METHOD_LIBRARIES[language] ?? []) as ApiMethodLibraryDto[]);
}

/**
 * Merge built-in defaults into a user's existing collection without disturbing their edits.
 *
 * Returns a new array: the user's items unchanged, plus any default whose key is not already
 * present. Use on activation so newly-shipped library methods appear for existing users while
 * their own additions and customisations survive. `keyOf` defaults to the method name (lowercased).
 */
export function mergeDefaults<T>(
  existing: T[],
  defaults: T[],
  keyOf: (item: T) => string = (item) => String((item as any).methodName ?? (item as any).id ?? '').toLowerCase(),
): T[] {
  const seen = new Set(existing.map(keyOf));
  const additions = defaults.filter((d) => !seen.has(keyOf(d)));
  return additions.length ? [...existing, ...additions] : existing;
}

/** What a seed refresh did — `replacedItems`/`addedItems` let a DB-backed client persist only those rows. */
export interface RefreshResult<T> {
  items: T[];
  /** Curated entries that replaced a stale shipped copy (each keeps the stored item's id). */
  replacedItems: T[];
  /** Curated entries appended because they were missing. */
  addedItems: T[];
  replaced: number;
  added: number;
  /** False when nothing differs — clients skip the write. */
  changed: boolean;
}

/**
 * Refresh a user's collection from the curated defaults (SEED-1, merge-on-activation):
 *
 *   - a shipped copy (`isCustom` not true — missing counts as shipped, older installs predate the
 *     flag) whose curated version changed is REPLACED, keeping the stored `id` so references survive;
 *   - anything user-owned (`isCustom: true`) is never touched, and its key blocks the curated
 *     version from being appended as a duplicate;
 *   - user methods outside the curated set are untouched;
 *   - new curated methods are appended.
 *
 * Clients flip `isCustom` to true when a user edits a built-in (take-ownership-on-edit), which is
 * what makes the replace safe. Supersedes {@link mergeDefaults} (kept for existing callers).
 */
export function refreshDefaults<T extends { id?: string; isCustom?: boolean }>(
  existing: T[],
  defaults: T[],
  keyOf: (item: T) => string = (item) => String((item as any).methodName ?? (item as any).id ?? '').toLowerCase(),
): RefreshResult<T> {
  const curatedByKey = new Map(defaults.map((d) => [keyOf(d), d]));
  const replacedItems: T[] = [];

  const items = existing.map((item) => {
    const curated = curatedByKey.get(keyOf(item));
    if (!curated || item.isCustom === true) return item;
    const replacement = { ...curated, ...(item.id !== undefined ? { id: item.id } : {}) };
    if (stableStringify(replacement) === stableStringify(item)) return item; // already current
    replacedItems.push(replacement);
    return replacement;
  });

  const seen = new Set(existing.map(keyOf));
  const addedItems = defaults.filter((d) => !seen.has(keyOf(d)));

  return {
    items: addedItems.length ? [...items, ...addedItems] : items,
    replacedItems,
    addedItems,
    replaced: replacedItems.length,
    added: addedItems.length,
    changed: replacedItems.length > 0 || addedItems.length > 0,
  };
}

/** JSON deep-copy of an array (imported JSON modules are shared/frozen-ish; never hand them out raw). */
function structuredCloneArray<T>(arr: T[]): T[] {
  return JSON.parse(JSON.stringify(arr)) as T[];
}

/** JSON with object keys sorted, so equality is property-order-insensitive. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
