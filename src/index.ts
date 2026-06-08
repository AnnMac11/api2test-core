/**
 * api2test-core — shared, UI-agnostic engine for API2Test.
 *
 * Public surface: the data models (DTOs) and the engine services. Consumers (VS Code
 * extension, web/enterprise app, Jira app) provide their own UI and wire storage/deploy/emit.
 *
 * Note: storage is currently the file-based {@link FileStorageService}. The `StorageProvider`
 * and `CodeEmitter` adapter interfaces (to support File/SQL/Mongo storage and C#/Python output)
 * are introduced incrementally — see ./adapters.
 */

// ── Models (DTOs) ──────────────────────────────────────────────────────────────
export * from './models';

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
export { AdminService } from './services/AdminService';
export { FileStorageService } from './services/FileStorageService';
