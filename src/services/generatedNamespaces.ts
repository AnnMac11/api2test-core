/**
 * Single source of truth for the namespaces of generated C# artifacts, so every generator
 * (libraries, request classes, E2E tests) lines up and the deployed project compiles + scales.
 *
 * Layout (folder == namespace, idiomatic C#):
 *   Libraries/                  -> {ROOT}.Libraries          (ApiMethods, DataGenerator — shared)
 *   Classes/{Application}/      -> {ROOT}.Classes.{App}      (request classes, per application)
 *   Tests/{Application}/        -> {ROOT}.Tests.{App}        (generated E2E tests, per application)
 *
 * ROOT is the project root namespace (configurable later; defaults to the project name).
 */
export const GENERATED_ROOT = 'Api2Test.Generated';

/** Sanitise an application name into a valid C# namespace segment (e.g. "Pet Shop" -> "PetShop"). */
export function nsSegment(name: string): string {
  const cleaned = (name || '').replace(/[^A-Za-z0-9]/g, '');
  if (!cleaned) return 'App';
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export const librariesNs = (root: string = GENERATED_ROOT): string => `${root}.Libraries`;
export const classesNs = (application: string, root: string = GENERATED_ROOT): string => `${root}.Classes.${nsSegment(application)}`;
export const testsNs = (application: string, root: string = GENERATED_ROOT): string => `${root}.Tests.${nsSegment(application)}`;

/** Folder (relative to the project root) for each artifact kind — mirrors the namespaces. */
export const librariesDir = (): string => 'Libraries';
export const classesDir = (application: string): string => `Classes/${nsSegment(application)}`;
export const testsDir = (application: string): string => `Tests/${nsSegment(application)}`;
