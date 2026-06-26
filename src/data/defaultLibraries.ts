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

const DATA_LIBRARIES: Record<TargetLanguage, unknown> = {
  csharp: csharpDataLibrary,
  python: pythonDataLibrary,
};
const API_METHOD_LIBRARIES: Record<TargetLanguage, unknown> = {
  csharp: csharpApiMethodLibrary,
  python: pythonApiMethodLibrary,
};

/** The built-in data-generation methods for a target language (fresh copy, safe to mutate). */
export function getDefaultDataLibrary(language: TargetLanguage = 'csharp'): DataMethodDto[] {
  return structuredCloneArray(DATA_LIBRARIES[language] as DataMethodDto[]);
}

/** The built-in HTTP wrapper / base-path / token methods for a target language (fresh copy). */
export function getDefaultApiMethodLibrary(language: TargetLanguage = 'csharp'): ApiMethodLibraryDto[] {
  return structuredCloneArray(API_METHOD_LIBRARIES[language] as ApiMethodLibraryDto[]);
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

/** JSON deep-copy of an array (imported JSON modules are shared/frozen-ish; never hand them out raw). */
function structuredCloneArray<T>(arr: T[]): T[] {
  return JSON.parse(JSON.stringify(arr)) as T[];
}
