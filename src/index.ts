/**
 * api2test-core — shared, UI-agnostic engine for API2Test.
 *
 * Public surface: the data models (DTOs) and the engine services. Consumers (VS Code
 * extension, web/enterprise app, Jira app) provide their own UI and wire storage/deploy/emit.
 *
 * Storage, code emission, and deploy are pluggable via the adapter interfaces in ./adapters
 * (StorageProvider — File/SQL/Mongo; CodeEmitter — C#/Python; DeployTarget — local/PR), selected
 * by the consumer at install time. Defaults today: FileStorageService + CSharpEmitter.
 */

// ── Models (DTOs) ──────────────────────────────────────────────────────────────
export * from './models';

// ── Adapters (pluggable storage / emit / deploy) ─────────────────────────────────
export * from './adapters';

// ── Engine services ────────────────────────────────────────────────────────────
export { ApiFormatAdapter } from './services/ApiFormatAdapter';
export { ApiFormatDetector } from './services/ApiFormatDetector';
export { OpenApiParserService } from './services/OpenApiParserService';
export { PostmanParserService } from './services/PostmanParserService';
export { ApiLibraryService } from './services/ApiLibraryService';
export { ApiClassLibraryService } from './services/ApiClassLibraryService';
export { ApiMethodLibraryService } from './services/ApiMethodLibraryService';
export { DataDictionaryService, NOT_ASSIGNED, PARAMETER } from './services/DataDictionaryService';
export { DataLibraryService } from './services/DataLibraryService';
export { ClassGenerationService } from './services/ClassGenerationService';
export { buildClassName } from './services/classNaming';
export { hasUnassignedMandatory, isMandatoryField, isDataMethodUnassigned } from './services/fieldCompleteness';
export type { CompletableField } from './services/fieldCompleteness';
export { TestGenerationService } from './services/TestGenerationService';
export type { TestGenerationRequest } from './services/TestGenerationService';
export { AdminService } from './services/AdminService';
export { FileStorageService } from './services/FileStorageService';

// Generated-artifact namespaces/folders (single source of truth across all generators).
export { GENERATED_ROOT, librariesNs, classesNs, testsNs, librariesDir, classesDir, testsDir, nsSegment } from './services/generatedNamespaces';
export { generateDataLibraryCode } from './services/generateDataLibrary';
export type { DataMethodCode } from './services/generateDataLibrary';

// Licensing / entitlements — shared premium-feature gating (subscription via signed tokens).
export type { Feature, Plan } from './licensing/features';
export { ALL_FEATURES, PLAN_FEATURES } from './licensing/features';
export type { Entitlement, EntitlementClaims } from './licensing/entitlements';
export { verifyEntitlement, hasFeature, FREE_ENTITLEMENT, LICENSE_PUBLIC_KEY } from './licensing/entitlements';

// Curated libraries (single source of truth) — built-in Data Library + API Method Library, keyed by
// target language. Editions seed from these (copy-if-missing + mergeDefaults) instead of own copies.
export { getDefaultDataLibrary, getDefaultApiMethodLibrary, mergeDefaults } from './data/defaultLibraries';

// E2E chain generation + local test runner (lifted from the enterprise app — shared by all editions).
export { generateTestForRow, methodName as e2eMethodName } from './services/E2ETestGenerationService';
// E2E composition rules (validation, placeholders, variable scope) — shared by the builders.
export {
  paramsOf, placeholdersOf, takesUrlTemplate, takesFieldPath,
  isConsumedClass, sourceEndpointKey, availableVarsBefore, validateSteps,
} from './services/e2eCaseLogic';
export type { MethodParamMap, PickerLike } from './services/e2eCaseLogic';
export { parseTrx, runDotnetTest, runDotnetBuild, methodNameOf, outcomeToStatus, parseApiCalls, extractBuildErrors } from './services/TestRunnerService';
export { parseVitestJson, parseTscErrors, runVitest, runTsc } from './services/TestRunnerService';
export type { RawTestResult, BuildResult, ApiCall, VitestRun } from './services/TestRunnerService';
