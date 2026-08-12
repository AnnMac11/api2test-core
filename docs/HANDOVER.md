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
2. `USER_MANUAL.md` — _(not present; core is a library, so user docs live in the editions.)_
3. [`DEVELOPER_MANUAL.md`](DEVELOPER_MANUAL.md) — module map + the licensing chapter (created 2026-07-17).
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

## Two class statuses (read before touching anything "status")

There are **two different, independent things** in the Class Library that both got called "status" —
this collision has confused multiple threads and is exactly what the CLS series (TASKS.md) untangles.
Keep them apart:

| | **ClassGenerationState** | **ClassStatus** (user RAG) |
|---|---|---|
| **What it means** | *How the **tool** generated the class* | *Real-world status of the **endpoint**, outside the tool* |
| **Who sets it** | The tool (machine-derived) | The user (manual) |
| **Values** | `generated` / `pending` / `error` / `empty` | `green` / `amber` / `red` / `grey` |
| **Meaning** | code produced / mandatory field unassigned / render threw / no body | automated & working / in progress or under maintenance / **API has a defect, not working** / not automated |
| **Where** | Rule is IN core (`batchClassGeneration.ts`, transient); persist only `generationError` | **Not in core yet** (CLS-2 adds `status` to `ApiClassLibraryDto`) |

Two consequences that trip people up:

- **The two reds are different.** ClassStatus `red` = *the API itself is broken* (user's judgement).
  ClassGenerationState `error` = *the tool failed to generate the class*. Desktop currently conflates
  them (a generate failure writes `status: 'red'` onto the user's RAG) — that's the CLS-2 bug fix. The
  tool must never write ClassStatus.
- **Name collision spans repos.** Core's transient type is *itself* called `ClassStatus`
  (`generated|pending|error|empty`); Desktop's user RAG is also `ClassStatus` (`red|grey|amber|green`).
  CLS-1 renames core's to `ClassGenerationState` so the persisted user field can own `ClassStatus`.

**Impact cascade** (the "which tests can run" / "impact of an API change" feature): a test case's status
is a **rollup** of the ClassStatus of the classes it uses — any red→red; else all green→green; else all
grey→grey; else amber. So an all-green test case is runnable; flip one class to red/amber (its API broke
or is under maintenance) and every test using it cascades. This rule is Desktop-only today
(`statusColours.ts`); CLS-3 lifts it here.

## State of play (update each session)

**As of 2026-08-10 (`IMPORT-HANG` — a real spec can be imported again; branch `develop`, UNCOMMITTED,
312 passing):** RESP-SCHEMA (below) shipped in VS Code 0.2.50 and the user's next Stripe import never
finished — *"it appears to be stuck. there is no error?"*. Measured: the committed adapter does
Stripe's 7.9 MB spec in **58 ms**; with RESP-SCHEMA it **ran an 8 GB heap out** after ~140 s, silently,
because nothing throws. Three causes, all in the import path, all fixed here:
**(1)** `resolveSchemaTree` clones its cycle guard per branch, so the guard is per-*path* and a shared
sub-graph is re-expanded once per route to it. Request bodies are shallow and never showed it;
Stripe's response graph is the whole object model. Bounded now by `MAX_SCHEMA_DEPTH = 3` /
`MAX_SCHEMA_NODES = 300` — depth 3 is precisely what renders it (field → items → the element's
members), and Stripe resolves in **99 ms / 5.7 MB**.
**(2)** `importFromAny` called `addItem` per endpoint, and `addItem` rewrites the entire collection —
589 full rewrites of a growing file. Quadratic, and **pre-existing**: RESP-SCHEMA only made each row
bigger. One read, one write now.
**(3)** `baseUrl` was misparenthesised (`||` binds tighter than `?:`), so **every OpenAPI v3 import
since forever** stored `https://undefined/…`. Fixed, plus the trailing slash Stripe declares.
Bug-first: `schemaExpansionBounds.test.ts` (471 KB → bounded for one endpoint) and
`importWriteCost.test.ts` (200 writes → 1); the URL fix REDs `importFidelity.test.ts`. 301 → 312.
**The lesson worth carrying:** every test fixture in this repo is a handful of endpoints, so nothing
here exercises *scale*. A change that is correct on 3 endpoints and fatal on 589 passes the whole
suite. **Adoption:** VS Code 0.2.51; **Desktop has NOT** — it shares this import path, so it has all
three bugs today.

**As of 2026-08-10, later the same day (`APP-ID-SINGLE`; branch `develop`, UNCOMMITTED, 313 passing):**
IMPORT-HANG's write fix reached VS Code and the user's import still took 5m13s — because the extension
kept **its own** `importFromAny` with the same per-endpoint loop. Core's parsers were imported; core's
orchestration was reimplemented there. Worth knowing here, because it is the failure mode this repo is
exposed to by design: a fix landing in core changes nothing for a client that only borrowed our parts.
Both clients' import seams should be read as *seams*, and any that re-implement an engine method are
carrying a fork.
While collapsing that duplicate, one method had a real reason to stay local — `importSingleEndpoint`
took no `applicationId`, so APP-ID-IMPORT had missed the URL-import path. The user's rule (*"if there is
an issue with the core, it should be fixed, no workaround"*) settles how those are handled: the gap is
closed here, not compensated for downstream. `importSingleEndpoint(url, application, applicationId?)`
now matches `importFromAny`; third case in `appIdImport.test.ts` is bug-first (RED undefined → GREEN).
**Adoption:** VS Code 0.2.52 (delegates both methods); **Desktop — nothing to adopt**, it has no caller
of `importSingleEndpoint`, but its `upload-api` route still builds DTO rows itself (APP-ID-IMPORT).
**Also spotted, not actioned:** `importFromPostman`/`importFromOpenApi` here have **no caller in any
repo** and still carry the per-endpoint `addItem` loop — dead code that keeps the fixed bug alive.

**As of 2026-08-10 (`RESP-SCHEMA` — response shapes now survive import; branch `develop`,
UNCOMMITTED, 301 passing):** DD-STRUCT below shipped and the user's own field still showed nothing.
Cause: import only ever resolved the **request** body schema. Responses were stored as
`generateExampleFromSchema`'s flattened skeleton, where every array is `[]` — so
`GET /v1/customers` returning `{ data: [Customer], … }` hit the disk as `{"data": []}` and the element
shape was gone. Since a GET has no request body and extraction falls back to `responseExamples` for
those endpoints, **every GET's fields had no recoverable shape at all** (441 of 589 rows in the user's
real store). New `responseBodySchema` on `UnifiedApiDto` + `ApiMethodDto`, filled with the same
`resolveSchemaTree` the request body uses; the example is untouched and still stored. 3 bug-first
tests driving the real import sequence (**2 failing** first), suite 298 → 301. **Existing rows are not
migrated — re-import is the only way to fill them**, so clients must render nothing rather than guess.
Worth carrying: the request-side half of this was fixed on 2026-07-15 (`74b00d4`) and the response
half was never filed — and no test in the repo referenced `responseExample` at all. **Adoption:** VS
Code the same day; **Desktop has NOT** (`../api2test/docs/TASKS.md`, DD-STRUCT-ADOPT covers both).

**As of 2026-08-10 (`DD-STRUCT` — a field's shape can be read back out; branch `develop`,
UNCOMMITTED, 298 passing):** Raised from VS Code, where the user was picking a data method for a
`data: array` field with nothing on screen saying what an element holds. Not a defect in extraction —
one row per top-level field is the agreed model — but the consequence was that the shape, which is
sitting in the endpoint's `requestBodySchema`, was unreadable by anything downstream. New
`describeFieldStructure(requestBodySchema, fieldName)` → `{ kind, elementType?, members[] }`, one
level deep, `undefined` on anything unreadable so a client can simply omit the display. Description
only: no rows, no type changes, nothing near generation. 7 bug-first tests (**6 failing** against a
stub first). **Adoption:** VS Code shows it as a read-only Structure block in Edit Field (same day);
**Desktop has NOT** — its Data Dictionary UI is its own, and its edit form still shows only the type
name, so a Desktop user picking a method for an array field is still blind. Noted in
`../api2test/docs/HANDOVER.md`.

**As of 2026-08-10 (`APP-ID-IMPORT` — the application link is stamped at import; branch `develop`,
UNCOMMITTED, 291 passing):**

- **Import now carries the application id, not just its name.** `toApiMethodDto` and
  `ApiLibraryService.importFromAny` take an optional `applicationId` and stamp it on every endpoint;
  `ApiClassLibraryService.addClass` copies it onto the class entry (so `DictionaryImportService`'s
  batch path gets it too). `ApiMethodDto`/`ApiClassLibraryDto` gained the documented field. Both params
  are optional — existing callers compile unchanged, they just keep the old name-only behaviour.
- **Edition adoption:** VS Code adopted it the same day (picker returns the app record; `addClass`
  prefers the endpoint's id, name lookup is the legacy fallback). **Desktop has NOT** — its
  `upload-api` route builds DTO rows itself and sets `application` only, so imports there stay
  name-linked until it passes the picked app's id through. Recorded in `../api2test/docs/HANDOVER.md`.
- Rebuild `dist` before either edition can see this (`npm run build`).

**As of 2026-08-08 (`SEND-1`/`NAME-1` — a GET step could not compile, and the API methods are renamed;
branch `develop`, UNCOMMITTED, 289 passing):**

- **`GetAsync` had a different contract from every other send helper.** It returned `Task<T>` — the
  deserialised body — while validators and extractors take an `HttpResponseMessage`, so no generated
  C# E2E test with a GET step could build (the user's `test5`: `CS1503` at both follow-up lines).
  TypeScript's `get` already returned the response, which settled which side was wrong. Fixed in the
  curated **C# and Python** library bodies and in `E2ETestGenerationService` (no `<object>`; a GET
  response is now recorded as capturable).
- **The names now describe usage, in all three seeded languages** — `ExtractFieldAsync`,
  `ExtractToken`, `ExtractBodyAs`, `DeleteByPathValueAsync`, `UploadFileAsync`, validators carrying
  their status codes (`ValidateSuccess_200_201Async`, `ValidateDeleted_200_204Async`, …
  400/401/403/404/409/422), `PetStoreBaseUrl`/`PetStoreApiKey`/`StripeBaseUrl`/`StripeSecretKey`.
  Ids are unchanged, so `refreshDefaults` renames in place in existing stores (REFRESH-1).
- **Saved cases keep working without a migration.** They store method NAMES (`item.ref`, `page.token`),
  so `canonicalMethodName` + `LEGACY_METHOD_NAMES` translate a pre-rename name at generation, in both
  the C# and TypeScript emitters. `friendlyMethodName` lost its `METHOD_LABELS` table — the name is
  the label now (minus `Async`), so label and generated code cannot drift. **Both editions see the
  label change**; noted in each HANDOVER.
- **The gap that let it ship is closed.** TS had a `tsc` compile guard, C# had none, so a compile error
  passed a green string-matching suite. `test/e2eCSharpCompile.test.ts` emits the shipped seed as
  `ApiMethods.cs` plus a generated chain and runs a real `dotnet build` (skipped, not failed, without a
  .NET SDK). Bug-first evidence: emitter reverted → CS0308; library reverted → CS0411; both → the
  user's exact CS1503.

**As of 2026-08-08 (`CLS-7` — a class is built from its endpoint now; branch `develop`, UNCOMMITTED,
284 passing):**

- **A class no longer depends on owning its dictionary rows.** The user found PetStore `placeOrder`
  with a class carrying **zero fields** — the VS Code Test Case builder said *"No request fields on
  this class"* and re-generating wrote nothing (`renderClassCode` → `null` → outcome `empty`, silently).
  The dictionary de-duplicates by field **name** across all endpoints and each row stores one
  `sourceEndpointId`, so `id`/`status`/`petId`/`quantity`/`shipDate`/`complete` were all owned by
  `addPet`, `deletePet` and `getOrderById`; `importApi` then handed `addClass` only the newly-added
  set, which was empty. A one-to-one link over a many-to-many relationship.
- **New `DataDictionaryService.fieldsForEndpoint(endpoint)`** — shape from the endpoint's own schema +
  parameters, `dataMethod`/args copied from the dictionary **by name** (user, 2026-08-08: *"create a
  class using the values to the data dictionary, do not link them"*). `importApi` and
  `resyncClassFields` both go through it; nothing filters on `sourceEndpointId` any more.
- **⚠ Signature change:** `resyncClassFields(id, endpoint?)` — the second argument was the dictionary.
  With an endpoint it also re-takes `method`/`endpoint`/`contentType`/`requestBodySchema`; without one
  (endpoint deleted) it refreshes from the class's own stored schema.
- **Edition impact.** Desktop ships the same defect and fixes it by taking this bump. VS Code adoption
  is **RB-26** (Generate → **Update & Generate**, overwriting the snapshot — this reverses its RB-16(b))
  and **RB-27** (drop the local `sourceEndpointId` filters in Add Class + the import dialog).
  Verified on a copy of the user's live store: placeOrder 0 → 6 fields.

**As of 2026-08-03 (`TYPE-1` C#, `CAP-TYPE`, `RUN-TRX` — branch `develop`, 275 passing):**

- **Three fixes, all raised by the VS Code user running a real PetStore chain end to end.** Each ships to
  **both** editions; VS Code has taken all three (0.2.32 / 0.2.33), **Desktop has taken none of them.**
  - **`TYPE-1` (C# only).** `emitCaptures` now prefers `state.varTypes` — the destination field's type —
    over the store-as pick, and the look-ahead passes `csPropertyName(prop)` so it stops silently
    resolving to `'string'`. Steps 1 & 3 remain open (read the type from the class model instead of
    regexing generated C#; add `coerce` to `CodeEmitter`), and until then
    `generateE2ETestTypeScript.ts` still calls the old 3-arg `emitCaptures` — **the fix is C#-only**.
  - **`CAP-TYPE`.** `captureTypes(language)` in `services/fieldTypes.ts` — the store-as picker offers
    concrete per-language types, which pass through `mapCaptureType` untouched. **Desktop impact:** its
    own `CAPTURE_TYPES` (`ui-browser/.../logic/captureRows.ts`) is now a duplicate; its picker stays
    abstract until **CAP-CORE**.
  - **`RUN-TRX`.** `runDotnetTest` passed VSTest's `--logger trx;…` to a Microsoft.Testing.Platform
    project, so no TRX was ever written and **every** local C# run — passing ones included — was
    reported as a build failure. `usesTestingPlatform` + `dotnetTestArgs` now pick the command line per
    platform. **Desktop impact: this was broken there too, identically**, for any `MSTest.Sdk` project;
    taking the bump fixes it with no client change.
- **Structural note worth carrying forward:** the sandbox `.csproj` template lives in the **clients**
  (VS Code: `src/services/sandboxScaffold.ts`), the runner lives **here**, and they have to agree about
  the test platform. Nothing enforces that — RUN-TRX is what it looks like when they drift.

**As of 2026-08-02 (`OVR-CASE` FIXED — both emitters; branch `develop`):**

- **✅ `OVR-CASE` DONE.** Overrides are keyed by the **spec field name** (correct at rest); the mapping to
  the generated property is now done at emit, by the same rule the class emitter uses:
  - **C#** — `formatPropertyName` lifted out of `ClassGenerationService` into `services/classNaming.ts`
    as exported **`csPropertyName`** (the service delegates). `classInitializer` maps every override key
    through it for the assigned name, the `csTypeOf` lookup, and the pinned-fields note. So
    `pet_id → PetId`, and the type is found, so `PetId = 5` is no longer quoted.
  - **TypeScript** — the opposite rule, and it had the same bypass: generated TS keeps the **raw JSON
    key**, quoted when it isn't a valid identifier, but the initializer didn't quote — `{ pet-id: … }`
    against a class declaring `'pet-id'`. `propKey` moved into `tsNaming.ts` as exported **`tsPropKey`**,
    now used by the request-class emitter *and* the initializer. `tsTypeOf`'s regex escaped as well.
  - **Python: not affected** — no Python emitter exists (PY-1 parked); only its seed libraries.
  - **Bug-first:** `test/overrides.test.ts` was the guard that should have caught it and didn't — it
    keyed overrides `Email`/`Age`, already PascalCase, so the mapping was never exercised. Re-keyed to
    the real client shape + a snake_case case, plus a non-identifier case in `test/e2eTypeScript.test.ts`
    (strict-`tsc` compiled). **4 RED → green. Build clean, 260/260.**
  - **Edition impact: BOTH.** Coordinated version bump on adoption. VS Code's paired `RB-21` (un-skip the
    pending assertion in `src/test/suite/e2eThreeStepChain.test.ts`) is now **ready to action**; Desktop
    gets the same fix for free but should re-run any test that pins a field.
  - **Deliberately not done:** a UI validator for the *casing* — it would mean re-implementing C# and TS
    naming in every client. A client-side check for **orphaned** pins and **type-mismatched values** is
    the useful half and is edition work. See `TASKS.md` → `OVR-CASE` (Done).

**As of 2026-08-01 (raised from VS Code — nothing landed in core yet; superseded by the entry above):**

- **🔴 `OVR-CASE` OPEN, and it breaks the build of any test that pins a field.** Found reviewing a
  three-class PetStore chain generated from the VS Code Test Case builder (add pet → create order →
  delete order). `classInitializer` ([E2ETestGenerationService.ts:68](../src/services/E2ETestGenerationService.ts:68))
  emits the override key verbatim — `new PetStoreCreateOrder() { petId = petId, status = "placed" }` —
  but `ClassGenerationService.formatPropertyName` PascalCases every property, so the class declares
  `PetId` / `Status`. C# is case-sensitive: the generated test does not compile whenever a pinned
  field's spec name is not already PascalCase (`petId`, `pet_id`, `shipDate`). Same cause makes
  `csTypeOf` miss (case-sensitive regex), so every override falls back to `string` and a numeric
  literal comes out quoted. **Fix at emit** — share `formatPropertyName` with the generator; clients
  are right to key overrides by field name. Full entry + bug-first plan in `TASKS.md` → `OVR-CASE`.
  - **Edition impact: BOTH.** Desktop and VS Code use the same generator and the same override shape,
    so both ship broken today and both need the version bump when it lands.
  - The rest of the chain checked out: captures thread correctly (pet id → order body, order id →
    delete URL), verb → send-method mapping is right, and the chain needs no API Method Library at all.
  - **Paired re-review:** `RB-21` in [`../Api2TestVS/docs/TASKS.md`](../../Api2TestVS/docs/TASKS.md) —
    un-skip the pending assertion in `src/test/suite/e2eThreeStepChain.test.ts` on delivery.

**As of 2026-07-30 (LIC-6 landed — sat uncommitted until 2026-08-02, committed then):**

- **✅ `LIC-6` DONE** — the licence **presentation** policy is now core's, not each client's.
  `manager.ts` decides *what* the access is; `src/licensing/presentation.ts` decides *what the user is
  told about it*: `WARN_WITHIN_DAYS` (7), `daysUntil`, `accessDaysLeft`, `accessWarns`, `licenceSummary`
  → `LicenceSummary {text,hint,warn,canRemove}`, `nudgeFor` → `Nudge {key,message,kind}`,
  `describeAccess`. All pure with an injectable `now`; all exported from `index.ts`. **Rendering stays
  client-side** — core supplies strings + flags, the client picks status bar / toast / page section.
  13 tests on a fixed `NOW` pin the counts, the shared threshold, the once-only welcome→d7→d1 schedule,
  singular "1 day", urgency-beats-welcome, "licence ends" ≠ "trial", and that `expired` nudges nothing.
  - **Edition impact: BOTH.** VS Code adopted it the same day; **Desktop has NOT** — its licence panel
    still duplicates this wording and will drift. That adoption is the open half.

**As of 2026-07-27 (two generator/dictionary fixes, both raised from VS Code):**

- **✅ E2E send-method routing fixed** (`b2b0fa7`) — a Class step was still selecting its send method
  inline, so PATCH mis-generated as `PostJson` and a form-encoded PUT as `PutJson`. Now routed through
  `chooseSendMethod(verb, contentType)` (E2E-SEL-1), so the full verb × content-type matrix comes from
  one source. Same commit: a standalone Class step with **no OUT capture** now emits the defaulted
  response validation (`DELETE` → `ValidateDeleteResponseAsync`, else `ValidateResponseAsync`) instead
  of nothing at all.
- **✅ URL-param binding fixed** (`46ddd57`) — a path/query field imported as `NOT_ASSIGNED`, so a
  mandatory one tripped `hasUnassignedMandatory` and **blocked class generation for bodyless
  endpoints**. URL values are supplied at run time, so `autoMatchDataMethods` now matches a path/query
  field against the name `parameter` (its real type is unchanged), reusing `findBestMatch`'s type filter
  + name tiers to pick `ParameterInt/String/Date/Bool`. Added `ParameterBool` (`=> false`) to the csharp
  and python seed libraries to complete the type set — **seed count 97→98**.
  - **Edition impact: BOTH** — same generator, same dictionary. Recorded in the VS Code handover as the
    "2026-07-27 core lifts".

**As of 2026-07-26 (EXEC series, `06e5edd`, branch `develop`):**

- **✅ `EXEC-2` DONE** — Desktop's branded run-report lifted into `services/runReport.ts`:
  `buildExecutionReportHtml(ex)` returns one self-contained inline-styled HTML doc (print-to-PDF) —
  header meta, summary band, per-test breakdown with the full API call chain.
- **✅ `EXEC-1` shared shapes DONE** (the task stays open for its edition-side half) —
  `models/execution.ts`: `ExecResult` / `Execution` / `ExecResultStatus` + `ApiCall`, now single-sourced
  here and imported by `TestRunnerService`, so runner and report can't drift. Exported via `./models`.
  - **Orchestration is deliberately NOT in core** (edition-boundary decision, 2026-07-17): core owns the
    primitives + the shapes; each edition wires deploy→run→parse for its own environment.

**As of 2026-07-25 (E2E-SEL-1 + APIM-SEND-1 + RB-1/RB-4 core pieces landed, branch `develop`):**

- **✅ `E2E-SEL-1` DONE** (`1866457`) — `services/e2eMethodSelection.ts` (exported):
  `chooseSendMethod(verb, contentType)` and `chooseExtractMethod(responseField, verb)`, smart defaults only
  (clients keep the full list). Extract returns the **method name only** — type stays with `E2E-CAP-1`, so
  **not subsumed**; both ship. Sub-fix: TS seed brought to validator parity (4 `Validate…ResponseAsync`
  added). Bug-first RED→GREEN for both helpers. **236/236 green, build clean.**
- **✅ `APIM-SEND-1` DONE** (`0f2f1bb`) — send-method matrix completed (`PutFormAsync`, `PatchJsonAsync`,
  `PatchFormAsync` in all 3 languages), the prerequisite for `chooseSendMethod`.
- **✅ `RB-1`/`RB-3` DONE** (`24b332e`) — `dataMethodMatching.ts` (`orderDataMethodsForField`,
  `sortDataMethodsByName`, shared `typeClass`; `DataDictionaryService` duplicate deleted).
- **✅ `RB-4` core piece DONE** (`5c9d2cf`) — `ApiClassLibraryService.resyncClassFields`.
- _Earlier this session (still current):_

- **✅ `#52` DONE (guard added; already functionally fixed).** Integer ids were NOT widening to
  `decimal` — `DataDictionaryService` keeps `integer` distinct and `ClassGenerationService.getCSharpType`
  maps `integer`→`int` / `number`→`decimal` (fixed earlier, never closed here). The gap was that no test
  pinned the **concrete generated property type** (extraction was covered in `extract.test.ts`, output was
  not). Added `emitter.test.ts` "#52: integer → `public int`, fractional number → `public decimal`".
  Bug-first: shown failing by regressing `getCSharpType`, then green. **215/215 green; guard-only, no
  `src`/`dist` change.** Closes the Desktop Phase-1 mirror.

- **✅ `SEED-2` DONE** — see below (committed `9d6616e`).
- **✅ `E2E-CAP-GET` committed** (`dc0bfeb`) — the 2026-07-23 one-line GET-branch fix was done but had
  never been committed; now on `develop` with its bug-first test.
- **✅ `CLS-5` — ALREADY SATISFIED (verified, no code change).** `RagStatus` is reachable from the
  package index today via `index.ts` `export * from './models'` → `models/index.ts`
  `export * from './classStatus'`. A `tsc` consumer `import type { RagStatus } from 'api2test-core'`
  compiles with no explicit re-export line. The VS Code `ApiClassLibraryDto['status']` workaround was
  unnecessary — clients can `import { RagStatus }` from the index. Doc-only commit `d4f9bb7`.
- **✅ `CLS-6` DONE** — `deriveClassState(entry, hasCode)` lifted into `services/classStatus.ts`
  (exported): `error` if `generationError` (wins over a stale file), else `generated` if `hasCode`, else
  `pending`. **Vocabulary decision (user, 2026-07-25): canonical set = the batch
  `ClassGenerationState` (`generated|pending|error|empty`)** — clients' `failed` folds into `error`;
  `empty` stays batch-only (never derived). Bug-first, **214/214 green, build clean, `dist` rebuilt.**
  Adoption: VS Code drops its `utils/classStatus.ts` `classGenerationState`; Desktop CLS-4 consumes it.

**As of 2026-07-25 (SEED-2 landed):**

- **✅ `SEED-2` DONE** — `PhotoUrls` (`List<string>`) + `Tags` (`List<object>`) added as curated
  (`isCustom: false`) worked-examples for array fields to all 3 seed sets (`data/libraries/{csharp,
  typescript,python}/data-library.json`, ids 97/98). Root cause of the VS Code "photos method missing"
  flag was simply that core's seed was never updated — the `refreshDefaults` merge pipeline is correct,
  so **both editions pick these up on next activation** (no client change needed). Bug-first: new
  `defaultLibraries.test.ts` presence case shown failing then green; counts 95→97. **213/213 green, build
  clean, `dist` rebuilt.** Also closes the long-standing Desktop Phase-2 `PhotoUrls` task. Core version
  left at `0.1.0` (coordinated bump happens at edition adoption, as with the prior lifts).

**As of 2026-07-23 (no core code changed — one task dropped, one bug filed; both came from the VS Code
thread):**

- **⛔ `E2E-CAP-1` is DROPPED — do not build it.** It was going to teach `generateTestForRow` to read
  `E2ECaseItem.capture` and emit a typed extraction, with a user-chosen scalar type picker in both
  builders. VS Code was the only client writing `capture`, and on 2026-07-23 it switched to authoring the
  **extract-METHOD step Desktop has always used** — `{type:'Method', ref:<extractor>, assignTo:<var>,
  args:{fieldPath:<field>}}` — which `methodStep` already generates, including the typed
  `ExtractField<T>` upgrade from the existing `varTypes` look-ahead. So the generator gap closes with no
  core change, and the type picker is unnecessary (the type already comes from the body field the
  variable feeds). **Desktop's matching `E2E-CAP` picker is also unnecessary — tell that thread.**
  - **Load-bearing for clients now:** `takesFieldPath`. VS Code finds the extractor **by shape, never by
    name**, so a renamed or user-authored extractor still works. Don't change that predicate casually.
  - `E2ECaseItem.capture` stays in the DTO for older records; nothing generates from it.
- **✅ `E2E-CAP-GET` FIXED later the same day** — one line in `classStep`'s GET branch
  (`state.lastResponse = respVar`), bug-first test in `e2eGenerator.test.ts`, **212/212 green**, `dist`
  rebuilt. The TS emitter was checked and never had the problem. Original finding below.
- **🐛 Bug filed — `E2E-CAP-GET` (verified against the current build).** `classStep` sets
  `state.lastResponse` for DELETE and for POST/PUT/form, but **not for GET**, so an extract step reading a
  GET response emits `ExtractFieldFromResponse(/* response */, "id")` — won't compile. One line; check
  `generateE2ETestTypeScript` for the same asymmetry. "GET a resource, capture its id, use it next" is an
  ordinary chain, so **both editions generate broken code for it today**.
- Core working tree otherwise untouched this session; nothing to build or ship.

**As of 2026-07-19 (E2E-GROUP-1 + E2E-RESP-1 + CLS-1/2/3 landed, branch `develop`, uncommitted→committing):**

- **Three VS-Code-blocking lifts done, bug-first, 211/211 green:**
  - **E2E-GROUP-1** — class-first grouping (`groupIntoCalls`/`isSendMethod`/`stepIncomplete`/
    `friendlyMethodName` + `CallGroup`) ported into `services/e2eCaseLogic.ts`; `validateSteps`
    reconciled to Desktop's class-first rule (a class with a URL `{placeholder}` always needs it bound).
  - **E2E-RESP-1** — `services/responseFields.ts` (`responseFields(example)` → dotted field paths).
  - **CLS-1/2/3** — user RAG `RagStatus` (`models/classStatus.ts`) + `rollupRag`/`resultToRag`
    (`services/classStatus.ts`); `ApiClassLibraryDto` gained `status`/`generationError`; the transient
    generation type/field renamed apart (`ClassStatus`→`ClassGenerationState`, outcome `.status`→`.state`).
- **Client adoption filed:** VS Code SP3-1b / E2E-RESP / CLS-2/3 unblocked; Desktop DA-10 / DA-11 /
  DA-12(CLS-4). The `.status`→`.state` outcome rename affects `batchGenerate.ts` /
  `useBatchClassGeneration` on adoption. Details in TASKS.md.

**As of 2026-07-17 (latest+ — VS Code Test Cases → E2E model, more core drift found):**

- **VS Code is unifying its Test Cases page onto Desktop's `TestCase { items[] }` model** (their
  "path A", incremental — uses core's existing `generateTestForRow` + `e2eCaseLogic` subset; no core
  change needed for A). Two core items filed from it:
  - **E2E-GROUP-1** — core's `services/e2eCaseLogic.ts` is a **subset** of Desktop's local copy; the
    class-first grouping (`groupIntoCalls`/`isSendMethod`/`stepIncomplete`/`friendlyMethodName`) is
    Desktop-only. Lifting it unblocks VS Code's **rich In/Out builder** (their path B / SP3-1b).
    Corrects a wrong VS Code note that claimed core already had these.
  - **E2E-MODEL-1** (optional) — no unified `TestCase` wrapper/store in core; VS Code owns its own for
    now. Filed so the duplication is visible; lift if a second edition needs it.

**As of 2026-07-17 (latest — VS Code Test Cases parity review, new core gaps found):**

- **Reviewing the VS Code Test Cases page against Desktop surfaced core work still needed.**
  Desktop's page is a builder-authored, multi-step surface with in-app **Execute** (result + API
  call chain + report) and a RAG-tinted list; VS Code's is the older single-test model. Mapping the
  Desktop deps against core:
  - **Generation = fully in core** — `generateTestForRow` (the exact multi-step generator) +
    `e2eCaseLogic`, both languages. Execution **primitives** all in core too (`ensureSandbox`,
    `deployUnit`, runner, `parseTrx`/`parseVitestJson`, `parseApiCalls`).
  - **Gaps found (now filed):** the `ExecResult`/`Execution` result types are Desktop-only → **EXEC-1
    (revised)**; the branded run-report HTML builder is Desktop-only → **EXEC-2**. The list's RAG tint
    is the already-parked **CLS series** (CLS-1..3).
  - **⚠ Edition boundary (user, 2026-07-17):** the execution *environment* differs per edition — VS Code
    runs in the user's own project via Test Explorer (no sandbox), Desktop in a managed sandbox + CI,
    Jira not at all. So **run orchestration stays edition-side**; core provides only the **primitives**
    (`runDotnetTest`/`runVitest`/`parseTrx`/`parseApiCalls` + `deployUnit` to a root) and the shared
    **result types** (EXEC-1 revised — no `runTestCase` orchestrator in core). Same principle keeps the
    app→folder/path **segment policy out of core** (VS Code passes core its own canonical segment;
    `nsSegment` is idempotent, so no core change) — each of the 3 editions owns its own layout + runtime.
  - **Sequencing:** CLS (class-status model) is **on hold, core-first**; EXEC-1/2 are the new
    foundation for VS Code's Test Cases Execute. Client build-out waits on these + LIC-5 adoption.

**As of 2026-07-17 (later session — parity lifts):**

- **⭐ Desktop→core parity series COMPLETE except PY-1** (all committed on `develop`, pushed
  through REG-1; DET-1 `759c076` → APP-1 `1687beb`): DET-1 toolchain detection
  (language-symmetric), DEP-1 `deployUnit` (+ `CodeEmitter` file-naming contract), SBX-1
  `ensureSandbox` (C# csproj + TS vitest scaffold), SEED-1 `refreshDefaults`
  (**take-ownership-on-edit decision** — clients flip `isCustom` on edit), REG-1
  `DeployDestinationService` (**path lives on the destination**, set in Admin, auto-applied at
  deploy), REG-2 `deployTestSet` (real-git tested), REG-3 CI ingestion (accepts TRX AND Vitest
  JSON), APP-1 `methodScope` (+ fixed real TS seed drift: missing `applicationId` links,
  off-taxonomy categories). All bug-first; **build clean, 193/193 green.** PY-1 stays parked
  until the TS extension path proves out.
- **Client adoption is mapped, not started:** Desktop DA-4..DA-9 in `../api2test/docs/TASKS.md`
  (left uncommitted there — that tree has unrelated in-progress work); VS Code notes on SP1-2/
  SP2-1/SP3-1 + deploy model v2 in `../Api2TestVS/docs/TASKS.md`. LIC-5 adoption still pending —
  both clients remain broken against the new core dist until it lands.

**As of 2026-07-17:**

- **⭐ Licensing restructured (LIC-1..4 DONE, local uncommitted; branch `develop`).** The plan/
  feature layer is GONE (no free/pro/enterprise, no `hasFeature` — whole-app gate per
  `../api2test/docs/HANDOVER.md` §4). Claims minimal (`sub`/`exp`/`iat?`/`iss?`), unknown claims
  ignored (commercial end-game deliberately open). New `licensing/manager.ts`:
  `createLicenseManager({ tokenStore, trialStore })` → `getAccess()` =
  `licensed | trial (daysLeft, 60d, stamped once) | expired`; `enterKey` stores only-if-valid.
  Key scripts updated (`sign.js` minimal claims, `--key`). All bug-first; **build clean, 130/130
  green.** Detail: TASKS.md LIC entries + `DEVELOPER_MANUAL.md` §3.
- **⚠ BOTH clients are broken against the new core dist until LIC-5 (adoption)** — they still
  import removed `hasFeature`/`FREE_ENTITLEMENT`/`.plan`. Deliberate; adoption is client work.
- **Agreed sequence (2026-07-17): finish CORE first, then the two editions.** Next in core: the
  Desktop→core parity lifts (DET-1 detection, DEP-1 deployUnit, SBX-1 sandbox, SEED-1 seed
  refresh, REG-1/2/3 destinations/deploy/results, APP-1 per-app URL+token, PY-1) — see TASKS.md.

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
