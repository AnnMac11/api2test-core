# HANDOVER — api2test-core (read me first)

_New-thread orientation + session-to-session state of play for the shared engine. Read this, then
[`TASKS.md`](TASKS.md), before proposing work. **Update the "State of play" section at the end of every
working session.** Created 2026-07-16._

## What core is

**`api2test-core`** — the shared engine behind every edition: spec parsing/detection (OpenAPI,
Postman), the Data Dictionary + libraries, code generation, the local test runner (TRX + Vitest), and
licensing/entitlements. Consumed by both **`../api2test`** (Desktop/Enterprise) and **`../Api2TestVS`**
(the VS Code extension) via `file:` / package dependency. **A change here ships to both editions** —
note the coordinated version bump on anything that ships.

## The docs (4, names shared across repos)

1. [`TASKS.md`](TASKS.md) — **source of truth for open core tasks** + Done (kept for re-verification).
2. `USER_MANUAL.md` — _(not present yet; core is a library, so user docs live in the editions.)_
3. `DEVELOPER_MANUAL.md` — _(not present yet.)_
4. `HANDOVER.md` — this file.

## Architecture (where things live)

- **Adapters** (`src/adapters`) — install-time choices: `StorageProvider` (File/SQL/Mongo),
  **`CodeEmitter`** (language: `CSharpEmitter` / `TypeScriptEmitter`; `emitterFor(language, storage)`
  selects), `DeployTarget`. The `CodeEmitter` interface has 5 emit kinds: request class, test,
  ApiMethods, Data Library, E2E.
- **Generators** (`src/services`) — per language + kind. C#: `ClassGenerationService`,
  `TestGenerationService`, `generateDataLibrary`, `generateApiMethodsCSharp`, `E2ETestGenerationService`.
  TypeScript: `generateRequestClassTypeScript`, `generateTestTypeScript`, `generateDataLibraryTypeScript`,
  `generateApiMethodsTypeScript`, `generateE2ETestTypeScript`. Naming bridge: `tsNaming.ts` (`tsSymbol`).
- **Runner** (`src/services/TestRunnerService`) — `runDotnetTest`/`runDotnetBuild` (+ `parseTrx`) and
  `runVitest`/`runTsc` (+ `parseVitestJson`, the custom Vitest reporter for per-test call attribution).
- **Seed libraries** (`src/data/libraries/<lang>/`) — curated Data + API Method libraries, language-keyed,
  wired in `data/defaultLibraries.ts` (`getDefaultDataLibrary` / `getDefaultApiMethodLibrary` / `mergeDefaults`).
- **Build/test:** `npm run build` (tsc), `npm test` (node:test over `test/*.test.ts`).

## State of play (update each session)

**As of 2026-07-16:**

- **⭐ TypeScript emit layer COMPLETE (TS-C1–C8 + C2).** Core can now generate a full TypeScript/Vitest
  project from a spec — request classes, `DataGenerator` (faker), `ApiMethods` (fetch + Reporter), single
  tests, E2E chains, seed libraries — via `emitterFor('typescript')`, with per-test API-call attribution
  in the runner. Generated TS reads like TS (camelCase via the shared `tsSymbol` transform). Every task
  landed with the **bug-first protocol** (a guard shown failing on broken output, then passing). **Build +
  108 tests green.** Full per-task detail + deferred follow-ups in [`TASKS.md`](TASKS.md).
- **Deferred TS follow-ups** (tracked in TASKS.md): data-library long tail (~13 of ~95 methods ported);
  form `toFormBody()` on request classes (needs a TS `FormUrlEncode` on the class side); typed
  native-extract in E2E (`ExtractField<T>` look-ahead).
- **Nothing reaches a user from core alone.** The VS Code extension must consume the seam
  (`emitterFor(getTargetLanguage())`, write `.ts`) and add toolchain detect/preflight + a TS project
  scaffold — tracked in `../Api2TestVS/docs/TASKS.md` (NF-2 extension half, NF-3, SP3-1b).
- **Also still open (non-TS):** the 4 Dependabot npm PRs (TS 5.9→7 + @types/node majors), #52 integer
  typing, engine test-assertion-depth audit — see TASKS.md Open.

## How we work

- **Tasks live in `TASKS.md`**, not the in-session tracker/chips. Read at start, append on agree, move to
  Done (don't delete) when finished, update before ending.
- **Bug-first protocol = the definition of done:** name the test that should have caught it → make it FAIL
  on the broken code (shown) → fix → same test passes (shown). An old test passing unchanged after a fix
  is a red flag. Tests drive the real generated output (e.g. strict `tsc` compile of emitted TS), never a
  mock past the step under test.
- **Coordinated with editions:** a shipping change bumps the version consumed by Desktop + VS Code.
