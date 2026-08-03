/**
 * api2test-core — shared, UI-agnostic engine for API2Test.
 *
 * Public surface: the data models (DTOs) and the engine services. Consumers (VS Code
 * extension, web/enterprise app, Jira app) provide their own UI and wire storage/deploy/emit.
 *
 * Storage, code emission, and deploy are pluggable via the adapter interfaces in ./adapters
 * (StorageProvider — File/SQL/Mongo; CodeEmitter — C#/TypeScript/Python; DeployTarget — local/PR), selected
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
export {
    typeClass, coarseKind, dataMethodKindLabel, orderDataMethodsForField, sortDataMethodsByName
} from './services/dataMethodMatching';
export type { TypeClass, CoarseKind, DataMethodOption } from './services/dataMethodMatching';
export { DataLibraryService } from './services/DataLibraryService';
export { DictionaryImportService } from './services/DictionaryImportService';
export type { DictionaryImportResult, BatchImportResult, BatchImportItem } from './services/DictionaryImportService';
export { generateClassLibrary, toClassGenerationRequest } from './services/batchClassGeneration';
export type { ClassGenerationState, ClassGenerationOutcome, BatchGenerateResult } from './services/batchClassGeneration';
// Class status model (CLS): the user RAG `RagStatus` (models) + the roll-up / result rule. Colours stay
// client-side (theme tokens). `rollupRag` drives the E2E/test-case impact cascade shared by both editions.
export { rollupRag, resultToRag, deriveClassState } from './services/classStatus';
export { ClassGenerationService } from './services/ClassGenerationService';
export { buildClassName } from './services/classNaming';
// TYPE-1: the one stored-type → declared-type map. Both class emitters delegate to it, so a client can
// show the user the exact type the generated code will declare (C# `int`, TS `number`, Python `int`).
export { fieldDisplayType } from './services/fieldTypes';
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

// Licensing — the WHOLE-APP gate shared by every edition (no per-feature gating, no free tier).
// Clients implement TokenStore/TrialStore and call createLicenseManager().getAccess(); see
// docs/DEVELOPER_MANUAL.md §Licensing.
export type { Entitlement, EntitlementClaims } from './licensing/entitlements';
export { verifyEntitlement, UNLICENSED, LICENSE_PUBLIC_KEY } from './licensing/entitlements';
export type { TokenStore, TrialStore, TrialData, AccessState, Access, LicenseManager } from './licensing/manager';
export { createLicenseManager, TRIAL_DAYS } from './licensing/manager';
// How that access is put to the user (LIC-6) — day counts, the warning threshold, the reminder
// schedule and the wording. Policy, so it is shared; rendering stays in each client.
export type { LicenceSummary, Nudge } from './licensing/presentation';
export {
  WARN_WITHIN_DAYS, daysUntil, accessDaysLeft, accessWarns, licenceSummary, nudgeFor, describeAccess,
} from './licensing/presentation';

// deployUnit (DEP-1) — the one code path that deploys a complete compilable unit (libraries +
// tests + referenced classes) into a target project, parameterised by emitter + layout. Clients
// keep their stores: classes via resolveClass, library methods passed in.
export { deployUnit, buildDeployedUnit, BUILD_VALIDATORS, cleanGeneratedArtifacts, safeArtifactName, safeFileName, projectDirOf } from './services/deployUnit';
export type { DeployCase, ResolvedClass, DeployUnitOptions, DeployUnitResult } from './services/deployUnit';

// Named deploy destinations (REG-1) — name -> repo/branch/path, set in Admin, selected at deploy
// time (the stored path is used automatically). REG-2 performs the push; REG-3 ingests results.
export { DeployDestinationService } from './services/DeployDestinationService';
export type { DeployDestinationDto, DeployDestinationInput } from './services/DeployDestinationService';

// Deploy a test set to a destination (REG-2) — ensure-clone -> deployUnit under the destination's
// stored path -> commit -> push. Machine git credentials; the only step that leaves the machine.
export { deployTestSet } from './services/deployTestSet';
export type { DeployTestSetOptions, DeployTestSetResult } from './services/deployTestSet';

// CI results ingestion (REG-3) — parse a posted pipeline report (TRX or Vitest JSON), match rows
// to test cases, attribute a release, build the source:'ci' Execution. Clients do HTTP + storage.
export { isValidIngestionKey, attributeRelease, parseCiReport, buildCiExecution } from './services/ciIngestion';
export type { IngestionTokenLike, ReleaseWindow, CiCaseRef, CiResultsMeta, CiExecResult, CiExecution } from './services/ciIngestion';

// Application-scoped method resolution (APP-1) — per-app base-path/token rule + the canonical
// method-category taxonomy, shared by every edition.
export { API_METHOD_CATEGORY, methodForApp, methodsByCategory, basePathOptions, tokenOptions } from './services/methodScope';
export type { ApiMethodCategory, AppScopedMethod } from './services/methodScope';

// Managed local sandbox (SBX-1) — scaffold + maintain the runnable test project local Execute
// deploys into (deploy model v2: never the user's workspace). Detect, never install.
export { ensureSandbox, SANDBOX_SCAFFOLDERS } from './services/sandboxProject';
export type { EnsureSandboxOptions, EnsureSandboxResult } from './services/sandboxProject';

// Toolchain detection (DET-1) — language-symmetric machine probes shared by every edition
// (detect, never install). detectDotnet is the C# deep probe the sandbox scaffold consumes.
export { detectToolchain, detectDotnet, pickTfm, parseSdkList, parseRuntimeMajors, probeVersion, TOOLCHAIN_PROBES } from './services/toolchainDetection';
export type { ToolchainInfo, ToolStatus, DotnetInfo, ProbeRunner } from './services/toolchainDetection';

// Curated libraries (single source of truth) — built-in Data Library + API Method Library, keyed by
// target language. Editions seed from these (copy-if-missing + mergeDefaults) instead of own copies.
export { getDefaultDataLibrary, getDefaultApiMethodLibrary, mergeDefaults, refreshDefaults } from './data/defaultLibraries';
export type { RefreshResult } from './data/defaultLibraries';

// E2E chain generation + local test runner (lifted from the enterprise app — shared by all editions).
export { generateTestForRow, methodName as e2eMethodName } from './services/E2ETestGenerationService';
// E2E composition rules (validation, placeholders, variable scope) — shared by the builders.
export {
  paramsOf, placeholdersOf, takesUrlTemplate, takesFieldPath,
  isConsumedClass, sourceEndpointKey, availableVarsBefore, validateSteps,
  isSendMethod, friendlyMethodName, groupIntoCalls, stepIncomplete,
} from './services/e2eCaseLogic';
export type { MethodParamMap, PickerLike, CallGroup } from './services/e2eCaseLogic';
// Response-example flattener (E2E-RESP core half) — dotted field paths for the builder's field dropdown.
export { responseFields } from './services/responseFields';
// Smart-default method selection (E2E-SEL-1) — the send method a class step pre-selects from its verb +
// content-type. A default only; the client keeps the full list. Shared so both editions agree.
export { chooseSendMethod, chooseExtractMethod, isFormEncoded } from './services/e2eMethodSelection';
// Branded run-report (EXEC-2) — one self-contained HTML doc (print-to-PDF) from an Execution. Shared so
// both editions render the identical report.
export { buildExecutionReportHtml } from './services/runReport';
export { parseTrx, runDotnetTest, runDotnetBuild, methodNameOf, outcomeToStatus, parseApiCalls, extractBuildErrors } from './services/TestRunnerService';
export { parseVitestJson, parseTscErrors, runVitest, runTsc } from './services/TestRunnerService';
export type { RawTestResult, BuildResult, VitestRun } from './services/TestRunnerService';
// ApiCall + the Execution/ExecResult result shapes (EXEC-1) come from ./models (single-sourced).
