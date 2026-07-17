/**
 * Application-scoped method resolution (APP-1) — which library methods apply to a selected
 * application. Lifted from the enterprise client so every edition resolves per-app base-path and
 * token methods the same way.
 *
 * The rule: methods link to an application **by id** (`applicationId`; rename-proof). A method is
 * in scope when it is GLOBAL (no `applicationId`) or its id matches the selected application.
 */

// API Method categories — the single canonical taxonomy (superset of every category the seed
// libraries ship, so no seeded method is ever orphaned by a missing value).
export const API_METHOD_CATEGORY = {
  HTTP: 'HTTP Requests',
  AUTH: 'Authentication',
  BASE_PATH: 'Base Path',
  RESPONSE: 'Response',
  SERIALIZATION: 'Serialization',
  DATA_VALIDATION: 'Data Validation',
  OTHER: 'Other',
} as const;
export type ApiMethodCategory = (typeof API_METHOD_CATEGORY)[keyof typeof API_METHOD_CATEGORY];

/** The minimum a method needs for scoping. */
export interface AppScopedMethod { applicationId?: string; category?: string }

/** True when the method applies to the selected application (global, or linked to it by id). */
export function methodForApp(m: AppScopedMethod, appId?: string): boolean {
  return !m.applicationId || m.applicationId === appId;
}

/** The methods of `category` in scope for the application. Case-insensitive on category. */
export function methodsByCategory<T extends AppScopedMethod>(methods: T[], category: string, appId?: string): T[] {
  const key = category.toLowerCase();
  return methods.filter(m => (m.category || '').toLowerCase() === key && methodForApp(m, appId));
}

/** Base-path method options for the application (drives the test header's base-path picker). */
export function basePathOptions<T extends AppScopedMethod>(methods: T[], appId?: string): T[] {
  return methodsByCategory(methods, API_METHOD_CATEGORY.BASE_PATH, appId);
}

/** Token method options for the application (drives the test header's token picker). */
export function tokenOptions<T extends AppScopedMethod>(methods: T[], appId?: string): T[] {
  return methodsByCategory(methods, API_METHOD_CATEGORY.AUTH, appId);
}
