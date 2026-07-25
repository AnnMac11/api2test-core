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
