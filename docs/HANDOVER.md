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
