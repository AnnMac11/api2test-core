# API2Test core (shared engine) — running task list

> **This file is the durable source of truth for open core tasks.** The in-session task tracker and
> background "chips" do NOT survive a new thread — this file does. Read it at the start of a session,
> append the moment a task is agreed, tick items off (don't delete) as they're done, and update it
> before ending a session. See `CLAUDE.md` → "Task tracking". _Created 2026-07-13._

Core is consumed by both the Desktop app ([`../api2test/docs/TASKS.md`](../../api2test/docs/TASKS.md))
and the VS Code extension ([`../Api2TestVS/docs/TASKS.md`](../../Api2TestVS/docs/TASKS.md)). Changes
here affect both editions — note the coordinated version bump on any task that ships.

## Open

- [ ] **Merge the 4 open Dependabot npm PRs** (added 2026-07-13) — merge one at a time, each verified
  with `npm run build && npm test` in core before the next; the two majors can genuinely break the build:
  - **PR #9 — TypeScript 5.9.3 → 7.0.2** (two-major compiler jump; expect new strictness errors).
  - **PR #10 — @types/node 20 → 26** (types for a much newer Node than the `'20'` CI builds on —
    consider together with a decision on bumping the build Node version).
  - PR #8 — tsx 4.22.4 → 4.23.0 (low risk).
  - PR #6 — rimraf 5.0.10 → 6.1.3 (low risk).
- [ ] **#52 — integer ids typed as `decimal`** (lives HERE in core; tracked in the Desktop finish line,
  `../api2test/docs/TASKS.md` Phase 1): `DataDictionaryService.ts:491` collapses `integer→number`, then
  `ClassGenerationService.ts:356` maps `number→decimal`. Fix via the bug-first protocol — tighten the
  `test/testGeneration.test.ts` assertion to pin `int`, show it fail, then fix. Ships to both editions.
- [ ] **Audit engine test assertion depth** (from the Desktop Phase-1 coverage audit): tests must pin
  the CONCRETE generated output (`public int Id`, not "a class was produced") — see
  `../api2test/tests/README.md` "How deep".

### Desktop→core lifts for VS Code parity — added 2026-07-17

Goal: VS Code gets Desktop's functionality; the enabling logic moves HERE so both editions consume
one implementation (clients stay UI + storage). From the 2026-07-17 review of Desktop `server/`
against core. Bug-first per task; coordinate version bumps.

- [ ] **DET-1 — toolchain detection.** One core detector from Desktop `dotnetInfo.ts`
  (`detectDotnet`) + VS Code `environment.ts` (node/npm — a second copy, already drifting); python
  probe later. Consumers: VS Code requirements page + NF-3c preflight, Desktop detect-and-prompt.
- [ ] **DEP-1 — deployUnit orchestration (controller only — the pieces all exist).** The sequence
  "resolve the classes a test needs → emit/write all artifacts → build-validate → run → report"
  from Desktop `deployUnit.ts`/`deployLibraries.ts`, parameterised by emitter + layout. Consumers:
  VS Code SP2-1, Desktop drops its copy.
- [ ] **SBX-1 — managed local sandbox.** Scaffold + maintain a runnable test project (C# csproj /
  TS package.json+tsconfig) for local Execute — from Desktop `sandboxProject.ts` + the NF-2 vitest
  scaffold. In VS Code this is invisible plumbing (deploy model v2: local runs never touch the
  user's workspace).
- [ ] **SEED-1 — seed refresh rule.** Merge-on-activation: curated seeds replace `isCustom: false`
  entries, user methods untouched (Desktop `seedLibraries.ts`; VS Code SP1-2 consumes).
- [ ] **REG-1/2/3 — deploy test sets to repo + CI results** (lift `gitDeploy.ts` / `gitAccess.ts` /
  `ciResults.ts` / `cicdConfig.ts`). REG-1: **named destinations** model (name → repo/path/branch,
  environment-linked; create-on-first-use). REG-2: deploy-a-test-set to a destination. REG-3:
  results ingestion. Consumers: VS Code deploy model v2 + NF-4, Desktop Phase 5. **0a decided
  2026-07-17: REG-2 performs the push** — authoring/runs stay local; Deploy pushes the selected
  test set to the destination repo.
- [ ] **APP-1 — applicationId-scoped base-path/token resolution.** The per-app URL/token rule is
  enterprise-client-only today; lift it so VS Code SP3-1 is a thin port.
- [ ] **PY-1 — Python emitters + pytest runner** (VS Code NF-1). Reuses the TS language seam; do
  after the TS extension path proves out.

### Licensing restructure (LIC series) — added 2026-07-17

Goal: **core owns all licence logic** (verify + trial clock + access rule); apps keep only token
storage + UI. Authority: `../api2test/docs/HANDOVER.md` §4 — whole-app gate, **no
per-feature gating**, one token type, lifetime vs subscription differ only in `exp`. Ships to both
editions — coordinate the version bump. Bug-first per task.

- [x] **LIC-1 — remove the plan/feature layer. DONE 2026-07-17 (local, uncommitted).**
  `licensing/features.ts` deleted; `hasFeature` gone; claims now `sub`, `exp`, `iat?`, `iss?`;
  `Entitlement` = `{ valid, expiresAt, reason? }`; `FREE_ENTITLEMENT` → `UNLICENSED`. Verifier
  IGNORES unknown claims (end-game open — token shape stays extensible). Bug-first: rewrote
  `test/entitlements.test.ts` to the new model FIRST — 3 red on the old code (minimal token
  rejected as 'unknown plan'; unknown-claims; UNLICENSED missing) → implemented → 9/9 green.
- [x] **LIC-2 + LIC-3 — trial clock + `createLicenseManager`. DONE 2026-07-17 (one module,
  local, uncommitted).** New `licensing/manager.ts`: `createLicenseManager({ tokenStore,
  trialStore, publicKeyPem?, trialDays? })` → `{ getAccess, enterKey, removeKey, getToken }`
  (async — VS Code SecretStorage is async; Desktop wraps fs trivially). `getAccess(now)` =
  valid token wins → trial (`daysLeft`, stamped once, soft by design) → expired; `TRIAL_DAYS=60`.
  `test/licenseManager.test.ts` (7) ports Desktop `trialStore` semantics over in-memory stores;
  the store-only-if-valid guard PROVEN (shown failing on a deliberately-broken variant, then
  restored green). Exported from `index.ts`.
- [x] **LIC-4 — key tooling. DONE 2026-07-17 (correction: the scripts DID exist).**
  `scripts/license/{generate-keys,sign}.js` were already there — updated instead of created:
  `sign.js` drops the `plan` claim (minimal claims, `--key` override), `generate-keys.js` takes an
  optional out-dir. New `test/licenseScripts.test.ts` (3) drives the REAL scripts end-to-end
  (generate → sign → `verifyEntitlement`; pins the claims shape to exactly sub/exp/iat/iss).
  (Prod keypair swap stays Desktop Phase 7 #10.) **Core total: build clean, 130/130 tests green.**
- [ ] **LIC-5 — adoption (NEXT — clients now BROKEN against new core dist until this lands).**
  Desktop: `licenseStore`/`trialStore` → thin store adapters over the manager; licence route/panel
  drop plan/features; 3 test files rewritten (removals listed in `../api2test/docs/TASKS.md`
  Phase 4). VS Code: SP4-1b/c — `licenseService` onto the manager, delete `featureEnabled` gates.
  Their old imports (`hasFeature`, `FREE_ENTITLEMENT`, `.plan`) no longer exist in core.

### TypeScript emitters (TS-C series) — added 2026-07-16

Goal: give the engine a TypeScript emit path parallel to the C# one, so the VS Code extension (and
Desktop) can surface TS/Vitest tests. The **runner side already exists** — `TestRunnerService.ts`
has `runVitest` / `runTsc` / `parseVitestJson` / `parseTscErrors`. Everything below is the missing
**emit** side (all current emitters are C#-only, none takes a `language` param). Each ships to both
editions — coordinate the version bump. Follow the bug-first test protocol per emitter (pin the
concrete generated TS, not "a file was produced").

- [x] **TS-C1 — language plumbing** (done 2026-07-16): added `'typescript'` to `TargetLanguage`;
  extended the `CodeEmitter` interface to all 5 kinds (request class, test, ApiMethods, Data Library,
  E2E); `CSharpEmitter` implements them by delegating to existing services; new `TypeScriptEmitter`
  stub throws per-method with its follow-up task id; added `emitterFor(language, storage)` selector.
  `defaultLibraries` map made `Partial` (TS seed lib is TS-C8). Tests in `test/emitter.test.ts`;
  build + 82 tests green. NOT DONE: the TS module/import strategy replacing `generatedNamespaces.ts`
  (no TS namespaces) — deferred to whichever emitter first needs file layout (TS-C3/C6).
- [x] **TS-C2 — per-test Vitest reporter** (done 2026-07-16): `emitVitestReporter()` emits a pure-Node
  (CJS, fs-only) Vitest reporter that reads each finished test's captured `logs`, pulls that test's
  `##A2T_CALL##` markers, and writes a `{ fullName: ApiCall[] }` map to `A2T_CALLS_FILE`. `runVitest` now
  drops the reporter into the sandbox, runs with `--reporter <it>`, then `parseVitestCallsMap` +
  `mergeVitestCalls` attach calls per test (and `calls` becomes the flattened union — resolving the old
  console-intercept tension; stdout is the fallback). Tests in `test/vitestReporter.test.ts` drive the
  emitted reporter directly (require it, feed a fake finished-task tree) — guard shown to fail on
  flat-across-run attribution. Build + 108 tests green.
- [x] **TS-C3 — API Methods TS emitter** (done 2026-07-16): `generateApiMethodsTypeScript.ts` emits
  `apiMethods.ts` — an `ApiMethods` class of static fetch `*WithToken` wrappers + `getResponseContent<T>`
  + `extractField<T>`, and a `Reporter` printing the same `##A2T_CALL##` markers as C#. Class/static shape
  kept identical to C# so `wrapperClass.wrapperMethod` resolves the same in TS-C6/C7. Wired into
  `TypeScriptEmitter.emitApiMethods`. Tests in `test/apiMethodsTypeScript.test.ts`: marker round-trips
  through the runner's `parseApiCalls`, and the emitted source is compiled with `tsc --strict` (proven to
  fail on broken output). Build + 85 tests green.
- [x] **TS-C4 — request-body class TS emitter** (done 2026-07-16): `generateRequestClassTypeScript.ts`
  mirrors the C# emitter path (flat body class + URL-param class). TS drops two C# devices — the property
  name *is* the JSON key (quoted when not an identifier), and `JSON.stringify` omits `undefined` so an
  optional unassigned field is just `name?: T`. Data-method defaults `= new DataGenerator().m()`, PARAMETER
  placeholder, `toJson()`. Wired into `TypeScriptEmitter.emitRequestClass`. Tests in
  `test/requestClassTypeScript.test.ts` (strict compile-check w/ a stub DataGenerator; guard shown to fail
  on an initialised optional field). Build + 90 tests green.
  - **Form support now DONE** (review fix 2026-07-16): `toFormBody()` is emitted for form-encoded classes,
    delegating to the seed `ApiMethods.formUrlEncode`. (Superseded the earlier "deferred" note.)
  - **Note:** the emitter path is flat only; the C# nested-schema generator (`generateNestedClasses`) isn't
    reachable from `emitRequestClass`, so TS has no nested-class port yet. Revisit if the emitter path grows
    nested support.
- [x] **TS-C5 — Data Library TS emitter** (done 2026-07-16): `generateDataLibraryTypeScript.ts` emits
  `dataGenerator.ts` — a `DataGenerator` class (request classes call `new DataGenerator().method()`),
  importing the `@faker-js/faker` singleton instead of Bogus. Each method's `code` is pasted verbatim
  (from the TS seed lib TS-C8 or the user); missing code → a throwing placeholder. Wired into
  `TypeScriptEmitter.emitDataLibrary`. Tests in `test/dataLibraryTypeScript.test.ts` (strict compile w/
  an ambient faker stub; guard shown to fail on a broken placeholder). Build + 93 tests green.
  - **NB user-facing:** faker is a dependency of the generated PROJECT, not of core — core only emits the
    `import`. On a locked-down machine it must be *detected + installed through the user's own registry*,
    never bundled. See Api2TestVS TASKS.md NF-3b/NF-3c (requirements page + deploy preflight).
- [x] **TS-C6 — test-file TS emitter** (done 2026-07-16): `generateTestTypeScript.ts` emits a Vitest
  `describe/it` file (the C# MSTest/NUnit/xUnit split collapses to one framework). Ties the emitters
  together — imports ApiMethods (C3) + DataGenerator (C5) + body class (C4), builds URL (path/query
  interpolation) + body (`toJson`/`toFormBody`), calls the wrapper `(token, url, body)`, asserts
  `response.ok` or a selected response handler. Wired into `TypeScriptEmitter.emitTest`. Tests in
  `test/testTypeScript.test.ts` — content assertions + a strict compile inside the real
  `Tests/<App>` · `Libraries` · `Classes/<App>` layout (guard shown to fail on wrong wrapper arg order).
  Build + 97 tests green.
  - **Resolves the TS-C1 open item — TS import strategy:** imports are RELATIVE paths computed from the
    folder==namespace layout (`Tests/<App>/` → `../../Libraries/…`, `../../Classes/<App>/…`),
    extensionless (Vitest's resolver handles it). No tsconfig `paths` needed.
  - **Constraint for TS-C8:** curated TS wrapper methods MUST take `(token, url, requestBody)` — the
    emitter calls them in that order, mirroring C#.
- [x] **TS-C7 — E2E TS emitter** (done 2026-07-16): `generateE2ETestTypeScript.ts` turns an ordered
  chain into a runnable Vitest test. Class-first — the send verb is derived from each class's HTTP method
  + content-type (`postJson`/`putJson`/`get`/`delete`/`postForm`, the TS-C8 vocabulary); captured fields
  (`extractFieldFromResponse`) flow into later steps; path `{placeholders}` bind from `args`; overrides →
  `Object.assign(new Ref(), { prop: value })` with type-aware values; validators → `expect(...).toBe(true)`.
  Method/Class pairing (a url-taking method consumes the class below it) ported. `ApiMethods.<idiomatic>`
  calls via `tsSymbol`; relative imports (same strategy as TS-C6). Wired into `TypeScriptEmitter.emitE2ETest`.
  Tests in `test/e2eTypeScript.test.ts` — a create→capture→get→validate chain, content + strict compile in
  the real layout (guard shown to fail on wrong send derivation). Build + 105 tests green.
  - **Deferred (follow-up):** the C# typed native-type extract (`ExtractField<T>` look-ahead / `varTypes`) —
    TS emits the plain `extractFieldFromResponse` (string). Revisit if strict APIs need captured numeric ids
    to stay numeric in request bodies (`Object.assign` sidesteps the compile error, so it's a fidelity, not
    a compile, gap).
- [x] **TS-C8 — language-keyed TS seed libraries** (done 2026-07-16): `data/libraries/typescript/`
  `data-library.json` + `api-method-library.json`, wired into `defaultLibraries.ts` (`typescript` key
  added to the `Partial` maps). Registry `methodName` stays PascalCase (the cross-language key); each
  method's `code` defines the idiomatic camelCase symbol per `tsSymbol` (`PostJsonAsync` → `postJson`) —
  so generated TS reads like TS. API Method Library is COMPLETE for the emit vocabulary: the five
  class-first send helpers `postJson`/`putJson`/`get`/`delete`/`postForm` (each `(token, url, body)`,
  reporting via `Reporter`), `extractFieldFromResponse`, `formUrlEncode`, success + negative validators,
  and per-app token + base-path methods (base-path in BOTH libraries by design — DataGenerator for the
  single-test flow, ApiMethods for E2E). Tests in `test/seedTypeScript.test.ts`: symbol↔`tsSymbol`
  consistency (shown failing on a drifted symbol), and the seed emitted through TS-C3/TS-C5 type-checks.
  Also added the shared `tsSymbol` transform (`tsNaming.ts`) + applied in TS-C4/TS-C6. Build + 103 green.
  - **Follow-up (deferred): data-library long tail.** Only a core ~13-method Data Library set is ported;
    C# has ~95. Port the rest (faker.js bodies) as needed — each is independent. Tracked here.
  - **Enables TS-C7:** the E2E send-helper vocabulary now exists + is name-checked.

### TS emit layer — review fixes (2026-07-16, from the VS Code review)

- [x] **#1 form endpoints compiled to broken code (real bug).** The test/E2E emitters emit
  `new Body().toFormBody()`, but TS-C4 didn't emit `toFormBody()` → tsc failure. Root cause also included
  TS-C4 importing `./dataGenerator` (flat) instead of the layout-correct `../../Libraries/dataGenerator`.
  Fixed: TS-C4 now emits `toFormBody()` (→ `ApiMethods.formUrlEncode`) and computes RELATIVE sibling
  imports. **The tests were masking it** — TS-C4/C6 compiled in a flat dir with stub classes that had a
  hand-written `toFormBody`. Reworked TS-C4 to compile in the real `Classes/<App>` + `Libraries` layout,
  and TS-C6 to compile against the REAL TS-C4 class (not a stub). Both form guards shown failing on the
  pre-fix emitter.
- [x] **#2 stale `TypeScriptEmitter` docstring / unused `_storage`.** Docstring said "stub… not built
  yet"; all five are implemented. Fixed docstring + clarified the unused-storage comment.
- [x] **#3 query values not URL-encoded** (was shared with C#). TS test emitter now wraps query values in
  `encodeURIComponent(String(...))`. Test added.
- [x] **#4 same-named path+query param → two `const` (won't compile).** TS test emitter now declares each
  distinct param var once. Test added.
- Build + 111 tests green after the fixes.

### Shared client orchestration → core (ORCH series) — added 2026-07-16

Three orchestrations sit ABOVE core's primitives and are hand-assembled in each client — duplicated (VS
Code `DataDictionaryImportDialog`, Desktop `server/coreExtract.ts` + `useBatchClassGeneration`). The
primitives already live in core (`DataDictionaryService.extractFieldsFromEndpoint` / `autoMatchDataMethods`
/ `addField`, `ApiClassLibraryService.addClass`, `fieldCompleteness`); only the SEQUENCE + the status RULE
are outside. Lift them so VS Code's new import page is thin (checkboxes → call core → render tally) and
Desktop later drops its copies onto the same methods. **Persistence stays per-client via `StorageProvider`**
— core takes the services/storage it already does; HTTP + the generated-class store stay in the clients.
**Reconcile drift, don't blind-copy** — the VS Code and Desktop copies may already differ (dedup,
skipped-count, the addClass try/catch policy); pick the correct behavior and pin it with tests. Desktop is
the more complete impl (it has ORCH-2/3), so it's largely the reference. Each lands bug-first.

- [x] **ORCH-1 — `DictionaryImportService.importApi(endpoint) → { addedFields, skipped }`** (done
  2026-07-16): lifts the Add-API-to-Dictionary sequence into core — extract-all vs dedup → `getDataMethods`
  → `autoMatchDataMethods` → `addField` per field → `addClass` (best-effort; class failure swallowed) →
  mark `importedToDataDictionary`. Takes a `StorageProvider` (builds the sub-services), so File/SQL/Mongo
  all work; normalises `requestBodySchema` to a string so both client shapes work. Exported from index.
  Tests in `test/dictionaryImport.test.ts` drive the real sequence over an in-memory store (fields
  persisted + tally, re-import dedups everything, class-failure-doesn't-block shown failing without the
  try/catch). Build + 114 green. **Reconciliation note:** VS Code did the full sequence; Desktop's
  `coreExtract` only did extract+match (persist happened in a route) — core now owns the whole sequence.
- [x] **ORCH-1b — `importApis(endpoints[]) → BatchImportResult`** (done 2026-07-16): batch import for the
  import table (pick 5 of Stripe's 200+). Loops `importApi` independently — one endpoint throwing is recorded
  on its row, not fatal to the batch. Returns per-endpoint tally + totals (`imported`/`failed`). Tested.
- [x] **ORCH-2 — batch class-generation driver** (done 2026-07-16): `generateClassLibrary(entries, emitter)`
  (pure) + `DictionaryImportService.generateClasses(emitter, endpointIds?)` (loads from the Class Library).
  REUSES existing pieces — the green/amber decision is `fieldCompleteness.hasUnassignedMandatory`, the render
  is the language `CodeEmitter` (`emitRequestClass`). Per class → `generated` (code) / `pending` (amber, not
  rendered) / `error` (red, captured, batch continues) / `empty` (no body). **Code returned; persistence
  stays with the client.** Tests in `test/batchClassGeneration.test.ts` (fake emitter; pending-rule guard
  shown failing when disabled). Build + 119 green.
- [x] **ORCH-3 — status rule: NOT NEEDED (already in core).** The green/amber decision is
  `fieldCompleteness.hasUnassignedMandatory` (its doc literally says it "drives the amber 'pending' vs green
  'generated' state"); red = a render error (captured by ORCH-2). No new function — ORCH-2 consumes the
  existing one. Dropped.

_Consumers (tracked elsewhere): VS Code import page + `SimpleTable` multi-select — `../Api2TestVS/docs/TASKS.md`;
Desktop drop-the-copy — `../api2test/docs/TASKS.md`._

## Done (kept for re-verification — do not delete)

_Move items here when complete; note the branch/PR + which editions consumed the bump._

- [x] **CI actions → node24 runtimes** (2026-07-13): checkout/setup-node v5 (`391d673`), then Dependabot
  majors merged — codeql-action 4 (PR #1), checkout 7 (PR #2), setup-node 6 (PR #3). CI green.
