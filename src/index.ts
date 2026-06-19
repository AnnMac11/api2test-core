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
export { DataDictionaryService } from './services/DataDictionaryService';
export { DataLibraryService } from './services/DataLibraryService';
export { ClassGenerationService } from './services/ClassGenerationService';
export { TestGenerationService } from './services/TestGenerationService';
export type { TestGenerationRequest } from './services/TestGenerationService';
export { AdminService } from './services/AdminService';
export { FileStorageService } from './services/FileStorageService';

// E2E chain generation + local test runner (lifted from the enterprise app — shared by all editions).
export { generateTestForRow, methodName as e2eMethodName } from './services/E2ETestGenerationService';
export { parseTrx, runDotnetTest, methodNameOf, outcomeToStatus } from './services/TestRunnerService';
export type { RawTestResult } from './services/TestRunnerService';
