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
- [x] **SEED-2 — promote `PhotoUrls` + `Tags` into the curated Data Library (all 3 languages). DONE
  2026-07-25.** Added both curated (`isCustom: false`) methods to
  `src/data/libraries/{csharp,typescript,python}/data-library.json` (ids 97/98): **`PhotoUrls`**
  (`List<string>`, `count:int=3` — C# `_faker.Image.PicsumUrl()` loop, TS `faker.image.url()`, Python
  `self._fake.image_url()`) and **`Tags`** (`List<object>`, `count:int=2` — self-contained `{id,name}`
  anonymous objects). returnType uses the shared `List<…>` token across all 3 langs (precedent:
  `StringList`/`StripeTaxIds`). Bug-first: new `test/defaultLibraries.test.ts` case "SEED-2: PhotoUrls
  and Tags array-field methods are curated in all 3 languages" — shown **failing** (methods absent in
  csharp/py/ts), then green; existing count assertions bumped 95→97. **213/213 green, build clean, `dist`
  rebuilt.** Merge pipeline was already correct (`refreshDefaults`) — core seed was just never updated;
  **VS Code + Desktop pick them up on next activation.** Closes the Desktop task
  `../api2test/docs/TASKS.md` Phase 2 ("Data Library `PhotoUrls` method for array fields"). _Original brief
  below._ Both were authored in **Desktop's local runtime data**
  (`../api2test/ui-browser/api2test.client/data/data-library.json`) as `isCustom: false` curated
  worked-examples for array fields, but were never promoted to core's seed — so neither editions'
  merge-on-activation (`refreshDefaults`) can hand them out. Root cause of the VS Code "photos method
  missing" flag: **core was never updated; the merge pipeline is correct** (`refreshDefaults` adds any
  curated method the user lacks — `src/data/defaultLibraries.ts:107`). Also closes the long-standing
  Desktop task `../api2test/docs/TASKS.md` Phase 2 ("Data Library `PhotoUrls` method for array fields",
  confirmed not-in-core 2026-07-13).
  - **`PhotoUrls`** — `List<string>` of random image URLs, param `count:int=3`. C#:
    `public List<string> PhotoUrls(int count = 3) { var urls = new List<string>(); for (int i = 0; i < count; i++) { urls.Add(_faker.Image.PicsumUrl()); } return urls; }`
  - **`Tags`** — `List<object>` of `{id, name}`, param `count:int=2` (self-contained anonymous objects
    so the shared library compiles without a per-API type — petstore `tags`). C#:
    `public List<object> Tags(int count = 2) { var tags = new List<object>(); for (int i = 0; i < count; i++) { tags.Add(new { id = _faker.Random.Long(1, 1000), name = _faker.Lorem.Word() }); } return tags; }`
  - Add to `src/data/libraries/{csharp,typescript,python}/data-library.json` (port the C# code to TS +
    Python idioms — cf. existing `ProfilePictureUrl` which is already 3-language). Rebuild `dist`.
    Bug-first: extend `test/defaultLibraries.test.ts` (the ParameterString/#56 pattern) to assert both
    names present in all 3 curated sets, red→green. **VS Code + Desktop pick them up on next activation.**

### Desktop→core lifts for VS Code parity — added 2026-07-17

Goal: VS Code gets Desktop's functionality; the enabling logic moves HERE so both editions consume
one implementation (clients stay UI + storage). From the 2026-07-17 review of Desktop `server/`
against core. Bug-first per task; coordinate version bumps.

- [x] **DET-1 — toolchain detection. DONE 2026-07-17 (branch `develop`).** New
  `services/toolchainDetection.ts`: **language-symmetric** `detectToolchain(language)` →
  `{ tools[], ready }` over a `TOOLCHAIN_PROBES` table with an entry per `TargetLanguage` —
  csharp, typescript AND python equal citizens (per the 2026-07-17 steer: no hard-coded-C#
  paths). Runner = VS Code's `cmd /c` shim (resolves `npm.cmd` via PATHEXT; subsumes Desktop's
  bare-exe runner), injectable for tests. .NET depth (`detectDotnet`/`pickTfm`/`DotnetInfo`, for
  the SBX-1 scaffold) is a separate function, NOT a privileged field on the shared shape; parsing
  split into pure `parseSdkList`/`parseRuntimeMajors` driven by real `dotnet --list-*` output.
  Bug-first: symmetry guard shown failing on an emptied python probe set, then restored.
  `test/toolchainDetection.test.ts` (9). Build clean, 139/139 green. **Adoption (client work,
  after core):** VS Code `environment.ts` toolchain half → core, Desktop drops `dotnetInfo.ts`.
- [x] **DEP-1 — deployUnit orchestration. DONE 2026-07-17 (branch `develop`).** New
  `services/deployUnit.ts`: `deployUnit(cases, { root, emitter, resolveClass, apiMethods,
  dataMethods, clean })` — collision guard (before any write) → clean (sandbox only) → shared
  libraries via the emitter → each test + its referenced classes → `{ files, notGenerated,
  deployedClasses }`. Language-symmetric: `CodeEmitter` grew the **naming contract**
  (`testFileName`/`classFileName`/`libraryFileNames`) — TS emits `X.test.ts` (Vitest discovery)
  + `apiMethods.ts`/`dataGenerator.ts` (the exact names TS-C6 imports resolve); C# keeps
  `XTests.cs`/`ApiMethods.cs`/`DataGenerator.cs`. Client boundaries per ORCH: generated-class
  store via `resolveClass` callback, library method lists passed in. Also lifted:
  `safeFileName` (traversal guard), `safeArtifactName`, `projectDirOf`, `cleanGeneratedArtifacts`,
  and `buildDeployedUnit(language, path)` (`dotnet build` / `tsc --noEmit`; python with PY-1).
  Bug-first: TS naming guard shown failing on a C#-style `XTests.ts` variant (Vitest would
  discover nothing). `test/deployUnit.test.ts` (14). Build clean, 153/153 green. **Adoption:**
  VS Code SP2-1; Desktop drops `deployUnit.ts`/`deployLibraries.ts` + most of `deploy.ts` —
  task recorded in `../api2test/docs/TASKS.md` (2026-07-17).
- [x] **SBX-1 — managed local sandbox. DONE 2026-07-17 (branch `develop`).** New
  `services/sandboxProject.ts`: `ensureSandbox(language, dir)` → `{ ok, reason?, projectPath?,
  tfm?, depsReady? }`, language-keyed off `SANDBOX_SCAFFOLDERS` (csharp + typescript; python →
  honest not-yet pointing at PY-1). C# = Desktop's scaffold lifted (tfm from core `detectDotnet`,
  pinned MSTest/Bogus csproj, write-only-on-change so no needless restores). TS = the NF-2
  scaffold created here: `package.json` (private; typescript/vitest/@faker-js/faker devDeps) +
  `tsconfig.json` pinned to the emit layer's proven compile settings (strict/ES2022/bundler/
  noEmit); **install stays an explicit client step** through the user's own registry, surfaced
  as `depsReady`. Detect-never-install throughout; caller keeps `dir`, edition gate + runner
  config. Bug-first: strict-mode compile-contract guard shown failing on a `strict: false`
  scaffold. `test/sandboxProject.test.ts` (8). Build clean, 161/161 green. **Adoption:** VS Code
  local Execute (invisible plumbing); Desktop DA-5 (recorded in `../api2test/docs/TASKS.md`).
- [x] **SEED-1 — seed refresh rule. DONE 2026-07-17 (branch `develop`).** New `refreshDefaults`
  in `data/defaultLibraries.ts` → `{ items, replacedItems, addedItems, replaced, added, changed }`:
  shipped copies (`isCustom` not true; missing flag = shipped) are replaced by the current curated
  version (stored `id` preserved so references survive), user-owned (`isCustom: true`) never
  touched (and blocks a duplicate append), missing curated methods appended, `changed: false`
  when nothing differs (clients skip the write; property-order-insensitive compare).
  `replacedItems`/`addedItems` let a DB-backed client (enterprise SQL/Mongo) persist only those
  rows — no extra layer needed. **Decision (user, 2026-07-17): take-ownership-on-edit** — clients
  flip `isCustom` to true when a user edits a built-in, which is what makes the replace safe;
  that flip is client work (VS Code SP1-2, Desktop DA-6). `mergeDefaults` kept for existing
  callers. Bug-first: propagation guard shown failing on a copy-if-missing variant.
  `test/seedRefresh.test.ts` (7). Build clean, 168/168 green.
- [x] **REG-1 — named destinations model. DONE 2026-07-17 (branch `develop`).** New
  `DeployDestinationService` over `StorageProvider` (File/SQL/Mongo all work):
  `DeployDestinationDto` = `{ id, name, repoUrl, branch ('main' default), path ('' = repo
  root), environmentId?, description? }`. add/update/remove/list, `getByName`
  (case-insensitive — picker/one-click key), unique-name + required-URL validation,
  `getOrCreate` for create-on-first-deploy where **an existing definition wins** (a deploy
  prompt can never silently redefine where a name points; guard shown failing on a redefining
  variant). **User decision 2026-07-17: `path` is set on the destination in Admin and used
  automatically at deploy time — nothing asked per deploy** (clients add a path column to the
  destinations UI). `test/deployDestinations.test.ts` (7). Build clean, 175/175 green.
- [x] **REG-2 — deploy a test set to a destination. DONE 2026-07-17 (branch `develop`).** New
  `services/deployTestSet.ts`: `deployTestSet(cases, destination, { cloneBaseDir, emitter,
  resolveClass, apiMethods, dataMethods })` — ensure-clone (tolerates an empty remote / missing
  branch) → `deployUnit` under the destination's stored `path` (confined to the clone; traversal
  rejected) → commit (explicit identity, works with no global git user) → push to the
  destination branch. Never cleans (destination repos accumulate); machine git credentials, no
  stored secrets; clone keyed by destination **id** so renames don't orphan it. Identical
  re-deploy = clean no-op (`pushed:false`). Bug-first: destination-path guard shown failing on
  a root-deploying variant. `test/deployTestSet.test.ts` (6) drives REAL git against a local
  bare remote. Build clean, 181/181 green.
- [x] **REG-3 — CI results ingestion. DONE 2026-07-17 (branch `develop`).** New
  `services/ciIngestion.ts` (pure — clients keep HTTP + stores): `isValidIngestionKey(key,
  tokens, legacyKey?)` (secure by default: nothing configured → nothing validates),
  `attributeRelease(tag, timestamp, releases)` (explicit tag wins → date window → un-bucketed),
  `parseCiReport(payload)` — **accepts BOTH pipeline formats** (TRX XML and Vitest JSON) into
  one shape, and `buildCiExecution(raw, meta, { testCases, releases })` → the `source:'ci'`
  Execution (rows matched by `methodNameOf`; an unmatched row kept verbatim — never silently
  dropped, guard shown failing on a filtering variant). `test/ciIngestion.test.ts` (7). Build
  clean, 188/188 green. Desktop `ciResults.ts` becomes a thin route over these (DA-8).
- [x] **APP-1 — applicationId-scoped base-path/token resolution. DONE 2026-07-17 (branch
  `develop`).** New `services/methodScope.ts`: `methodForApp` (in scope = GLOBAL (no
  `applicationId`) or id matches; no app selected → only globals — the enterprise rule),
  `methodsByCategory` (case-insensitive), `basePathOptions`/`tokenOptions`, and the canonical
  `API_METHOD_CATEGORY` taxonomy lifted from the enterprise client. **Found + fixed real TS
  seed drift** (caught by the new guards): the four per-app token/base-path methods had NO
  `applicationId` link, and categories were off-taxonomy (`Response Handling`/`Validators`/
  `Configuration` → `Response`/`Serialization`/`Base Path`); C#+Python seeds were correct.
  Guards: seed round-trip per language (petstore token resolves only for app-petstore) +
  no-orphaned-category — both shown failing on the real drifted seed, green after the fix.
  `test/methodScope.test.ts` (5). Build clean, 193/193 green. VS Code SP3-1 + Desktop
  (drop `constants/values.ts` taxonomy + the TestCasesPage local rule) are thin ports.
- [ ] **PY-1 — Python emitters + pytest runner** (VS Code NF-1). Reuses the TS language seam; do
  after the TS extension path proves out.

### Class status model (CLS series) — added 2026-07-17

Goal: move BOTH class-status concepts + the impact cascade into core so both editions share one
model, and **untangle the two things that currently collide under the name "status"** (see the new
"Two class statuses" chapter in [`HANDOVER.md`](HANDOVER.md) — read it before starting). The concepts:

- **ClassGenerationState — how the *tool* generated the class** (machine-derived, internal). The RULE
  already lives here: `generateClassLibrary` (`services/batchClassGeneration.ts`) returns per-class
  `generated | pending | error | empty`. But (a) it is transient — returned, never persisted — and
  (b) core's type for it is *itself* named `ClassStatus`, colliding with the user RAG below.
- **ClassStatus — the real-world status of the *endpoint*, outside the tool** (user-set RAG):
  **grey** = not automated, **amber** = in progress / under maintenance, **green** = automated &
  working, **red** = the API has a defect / not working. **Not in core at all** — no field, no type.
- **Impact cascade** — a test case's status = a rollup of the ClassStatus of the classes it uses.
  **Not in core** — lives only in Desktop `ui-browser/.../shared/utils/statusColours.ts` (~36 lines).

- [x] **CLS-1 — rename core's transient generation status apart from the user RAG. DONE 2026-07-19
  (branch `develop`, uncommitted).** Renamed the `batchClassGeneration` type `ClassStatus`
  (`generated|pending|error|empty`) → **`ClassGenerationState`** and re-exported under the new name.
  **Went one step past a type rename (root-cause fix):** the `ClassGenerationOutcome` FIELD was also
  named `status` — the shared field *name* is what let Desktop copy a generation outcome into the user
  RAG. Renamed the outcome field **`status` → `state`**. Core-internal callers updated. **⚠ ORCH caller
  change:** consumers that read `outcome.status` now read `outcome.state` (VS Code `batchGenerate.ts`,
  Desktop `useBatchClassGeneration`) — see the adoption notes. Compile-guarded by `tsc` (build clean).
- [x] **CLS-2 — persist the two fields on `ApiClassLibraryDto`. DONE 2026-07-19.** Added **`status?`**
  (user RAG `RagStatus` = `'grey'|'amber'|'green'|'red'`, default `'grey'` — new `models/classStatus.ts`)
  and **`generationError?`** (set only when a generate errored — the one generation-state not re-derivable
  from code presence + `hasUnassignedMandatory`). Core `generateClassLibrary` returns outcomes and never
  writes the entry's `status` (the separation is enforced core-side). Bug-first: a guard that a failed
  generate leaves the entry's user `status` untouched — shown **failing** on an injected red-hijack
  variant, then green. (The Desktop-side `status: 'pending'` retire + the red-after-regenerate laundering
  fix are Desktop client work — CLS-4.)
- [x] **CLS-3 — lift the RAG rollup / colour rule into core. DONE 2026-07-19.** New
  `services/classStatus.ts`: `rollupRag(statuses[])` (any red→red; else all green→green; else all
  grey→grey; else amber; empty→grey) + `resultToRag` (pass→green/fail→red/skip→amber/else grey), both
  exported from `index.ts`; `RagStatus` lives in `models/classStatus.ts`. **Colours stay in the clients**
  (theme tokens) — only the rule is here. Bug-first: `rollupRag` truth table + `resultToRag`
  (`test/classStatus.test.ts`). **Build clean, 211/211 green.**
  - **Adoption (client work, after core):** VS Code CLS-2/CLS-3 (Class Library columns + Test Cases/Test
    Sets rollup; consume `rollupRag`; update `batchGenerate.ts` `outcome.status`→`.state`). Desktop CLS-4
    (drop the local `statusColours` + `useBatchClassGeneration` `.status`→`.state`; fix the
    red-after-successful-regenerate bug where `status` laundering only handled `'pending'`→`'grey'`).
    Both tracked in their repos.
- [ ] **CLS-5 — re-export `RagStatus` from the core `index`. Filed 2026-07-19 (from VS Code CLS-2 adoption).**
  `rollupRag`/`resultToRag` are exported from `index.ts`, but the **`RagStatus` type is not** — it's only
  reachable via `models/classStatus`. VS Code worked around it with `ApiClassLibraryDto['status']` indexed
  access, but both editions want the named type. One line: `export type { RagStatus } from './models/classStatus';`
  (or add it to the existing `classStatus` re-export). Trivial; do on the next core touch.
- [ ] **CLS-6 — lift the class-generation-state DERIVATION into core (both editions derive it). Filed
  2026-07-19 (from VS Code CLS-2).** Core owns the transient state as a BATCH outcome (`generateClassLibrary`
  → `.state`), but the rule to derive a **library entry's** display state on demand (not mid-batch) is
  duplicated in the clients: VS Code added `utils/classStatus.ts` `classGenerationState(entry, hasCode)`
  (`failed` if `generationError`, else `generated` if code exists, else `pending`), and Desktop CLS-4 will
  derive the same. Lift a small pure `deriveClassState(entry, hasCode)` into core `services/classStatus.ts`
  so both agree — **and reconcile the vocabulary**: the batch outcome uses `error`/`empty`, the client
  derivation uses `failed` and folds `empty` into `pending`. Decide one word set (client display maps
  colours regardless). Not blocking — filed so the third copy doesn't drift. Bug-first per the rule.

### Local execution orchestration (EXEC series) — added 2026-07-17

Goal: give both editions **one core path to run a test case locally and get a result back**, so the
VS Code Test Cases page can match Desktop's in-app **Execute** (result + API call chain + report).
From the 2026-07-17 review of Desktop `TestCasesPage` + `/api/execution/run` against core:
**generation is fully in core** (`generateTestForRow`, `e2eCaseLogic`, both languages) and so are all
execution **primitives** (`ensureSandbox`, `deployUnit`, `buildDeployedUnit`,
`runDotnetTest`/`runVitest`, `parseTrx`/`parseVitestJson`, `parseApiCalls`) — but the **assembly** and
the **result types** are Desktop-only. Bug-first per task; coordinate the version bump.

- [ ] **EXEC-1 — result types only (REVISED 2026-07-17). ⚠ Orchestration is NOT core.** Original idea
  was a `runTestCase` orchestrator (`ensureSandbox → deployUnit → run → parse`) in core — **revised
  after the edition-boundary review (user, 2026-07-17): the execution *environment* differs per edition
  and must NOT be baked into core.** VS Code runs in the **user's own open project** via Test Explorer /
  C# Dev Kit (no sandbox); Desktop runs in a **managed sandbox** + `dotnet test` + CI; Jira does **not
  execute** at all. So a single core orchestrator would impose Desktop's environment on everyone.
  - **Core lifts ONLY the shared shapes:** `ExecResult` / `Execution` types (status pass/fail/skip,
    durationMs, message, `calls[]`) from Desktop `execution-suites/types/execution.types.ts`, so the
    editions agree on the result shape. The run **primitives already in core** stay the shared engine
    (`runDotnetTest`/`runVitest`/`parseTrx`/`parseVitestJson`/`parseApiCalls` + `deployUnit` to a given
    root).
  - **Orchestration stays edition-side:** each edition wires deploy→run→parse for its own environment
    (VS Code: workspace/project + Test Explorer, which it already does; Desktop: sandbox + CI). VS Code
    only needs the result types **if/when** it shows results in-app (otherwise it keeps the Test-Explorer
    hand-off). Bug-first applies where the orchestration lives (in the edition), not here.
- [ ] **EXEC-2 — branded run-report HTML builder.** Lift Desktop
  `execution-suites/logic/runReport.ts` (`buildExecutionReportHtml(execution)`) into core (pure, no
  DOM) so both editions render the same print-to-PDF report from an `Execution`. Colours come from the
  CLS-3 result→RAG map (sequence after CLS-3, or inline a minimal map and swap later). Bug-first: pin
  the report contains each row's status + calls for a known Execution.

Note: the RAG rollup / impact-cascade tint on the Test Cases list is **CLS-3** above, not here.

### E2E builder logic lift (E2E-GROUP series) — added 2026-07-17

Goal: core owns ALL the E2E-builder composition logic so both editions share one implementation.
Found during the VS Code Test Cases parity review: core's `services/e2eCaseLogic.ts` is a **subset** of
Desktop's local `e2e-test-cases/logic/e2eCaseLogic.ts` — the two have **drifted**. Core has
`validateSteps`/`paramsOf`/`placeholdersOf`/`availableVarsBefore`/`isConsumedClass`/`sourceEndpointKey`/
`takesUrlTemplate`/`takesFieldPath`. **Missing from core (Desktop-only):** the class-first "In/Out"
grouping — `groupIntoCalls`, `isSendMethod`, `stepIncomplete`, `friendlyMethodName`.

- [x] **E2E-GROUP-1 — lift the class-first grouping into core. DONE 2026-07-19 (branch `develop`,
  uncommitted).** Ported `groupIntoCalls` / `isSendMethod` / `stepIncomplete` / `friendlyMethodName`
  (+ the `CallGroup` type) from Desktop `e2e-test-cases/logic/e2eCaseLogic.ts` into core
  `services/e2eCaseLogic.ts`; all re-exported from `index.ts`. **Reconciled the `validateSteps`
  drift** (user decision 2026-07-19: if it can live in core it should, VS Code consumes it): adopted
  Desktop's class-first rule — a class with a URL `{placeholder}` **always** needs it bound (was:
  only when a send method sat above it via `isConsumedClass`), wording "needs a **value** for the URL
  placeholder". Bug-first: `groupIntoCalls` truth-table (send-row + class-led row + orphan) + a
  `validateSteps` standalone-unbound-class case, both shown failing on the pre-lift source (6 red),
  then green; one existing fixture (`extract step without assignTo`) legitimately updated to bind its
  class placeholder. **199/199 green, build clean.**
  - **Adoption (client work, after core):** Desktop drops its local `e2eCaseLogic.ts` copy and imports
    from core (filed in `../api2test/docs/TASKS.md` + HANDOVER). VS Code SP3-1b (rich In/Out builder)
    now unblocked — core exports the grouping.
  - **⚠ Corrected an earlier wrong note:** VS Code SP3-1b previously claimed "core already exports
    groupIntoCalls/isSendMethod" — it did not until now.
- [x] **E2E-RESP-1 — response-example flattener (core half). DONE 2026-07-19 (branch `develop`,
  uncommitted).** New `services/responseFields.ts`: `responseFields(example) → string[]` — flattens a
  response example into dotted field paths (`id`, `address.city`) so the E2E builder can OFFER response
  fields in a dropdown instead of a raw text box ("make API response data accessible"). Ported from
  Desktop's Next route `api/e2e/response-fields` (the pure `flatten`), edition-neutral, behaviour
  identical: objects up to 2 levels deep, arrays never descended, deduped; added tolerant input
  (accepts a parsed object OR a JSON string; `[]` on primitive/array/invalid — never throws). Exported
  from `index.ts`. The store lookup / spec re-parse / HTTP stay in the clients. Bug-first: written
  test-first (6 cases: nesting, depth cap, arrays-not-descended, top-level array/primitive, JSON-string
  input, dedup) — shown failing (module absent), then green. **205/205 green, build clean.**
  - **Adoption (clients):** VS Code E2E-RESP (flatten the endpoint's stored `responseExamples` into the
    capture/param dropdown). Desktop DA-11 — the route drops its local `flatten`, calls core.
- [x] **E2E-CAP-GET — FIXED 2026-07-23 (same day it was filed).** One line in `classStep`: the GET
  branch now sets `state.lastResponse = respVar`, like DELETE and POST/PUT/form already did. The TS
  emitter was checked and is fine — `generateE2ETestTypeScript` sets `lastResponse` unconditionally
  after every class step, so it never had the asymmetry. Bug-first: new `e2eGenerator.test.ts` case
  "a capture after a GET reads the GET response (E2E-CAP-GET)" — GET pet → extract id → DELETE by that
  id — shown **failing** on the old generator ("the extract must read the GET response", emitted
  `/* response */`), then passing. **212/212 core tests green**, `dist` rebuilt, and the VS Code
  extension re-run against it (80 passing). _Original entry:_ an extract step after a GET class step
  emits `/* response */`. Filed 2026-07-23
  (found while fixing VS Code's OUT capture; verified against the current build).** `classStep`
  (`E2ETestGenerationService.ts` ~:108) sets `state.lastResponse = respVar` for **DELETE** and for the
  POST/PUT/form branch, but the **GET branch does not** — even though it declares `var responseN = await
  GetAsync<object>(...)`. So `resolveArg`'s `response` lookup finds nothing and a following extract step
  generates `var orderId = await ExtractFieldFromResponse(/* response */, "id");` — it won't compile.
  Reproduced with a GET class + `ExtractFieldFromResponse` chain.
  - **Fix:** set `state.lastResponse = respVar` in the GET branch (one line). Check the TS emitter
    (`generateE2ETestTypeScript`) for the same asymmetry.
  - **Why it matters:** "GET a resource, capture its id, use it in the next call" is an ordinary chain —
    both editions' builders offer it, so both generate broken code today.
  - **Bug-first:** a GET → extract → use chain must pass the class's response variable to the extractor;
    shown failing on the current generator (`/* response */`), then passing.
- [ ] **E2E-SEL-1 — Edition-neutral extract/send method selection (new, 2026-07-25).** Both clients
  need to **auto-select** which library methods a test-case step uses, and today that logic only exists
  (partly) inside Desktop's client (`e2eCaseLogic.ts` — `extractRef` finds a single extractor by shape).
  VS Code would have to re-port it (the same drift that hit `responseFields`/app-id linking). Lift the
  decision into core as **pure, UI-free helpers** so Desktop and VS Code call one implementation.
  - **Design (user, 2026-07-25):**
    1. **Selecting a class auto-picks the SEND method and the RESPONSE/extract method** from the class's
       API type/verb (GET/POST/PUT/DELETE).
    2. **Selecting an OUT response field updates the extract method** chosen for that capture (driven by
       the field + API type — e.g. a token-ish field → `ExtractToken`, a typed scalar → `ExtractField<T>`).
    3. Selection is a **smart default only** — clients keep the **full method list** so a user's custom
       method is still selectable. Core returns the recommended ref; it does not restrict the list.
  - **Core work:** pure helpers e.g. `chooseSendMethod(apiTypeOrVerb)` and
    `chooseExtractMethod(responseField, apiType)` → a method ref resolved **by shape** (reuse
    `takesFieldPath`, never by name), type-aware (align with `ExtractField<T>` + `E2E-CAP-1`). No vscode/
    Next imports. Export from the same surface as `responseFields`/`takesFieldPath`. Bug-first tests:
    class verb → send+extract ref; response-field type → expected extract ref; custom method still valid.
  - **Adoption:** VS Code **RB-8** (`../Api2TestVS/docs/TASKS.md`); Desktop consumes it in place of its
    client-side `extractRef`/auto-pick logic (see Desktop `HANDOVER.md` note, 2026-07-25).
  - **Relationship to `E2E-CAP-1`:** if the auto-selected extract method already encodes the type, it may
    subsume the manual capture-type picker — flagged for the user in RB-8; don't build both blindly.
- [ ] **E2E-CAP-1 — REVIVED 2026-07-25 (user reversed the 2026-07-23 drop).** The type picker is
  wanted after all: the "type is inferred from the body field the variable feeds" theory only holds when
  the captured variable lands in a **typed body field** downstream. The common case — capture `id` →
  `orderId`, then feed it to a **URL placeholder** `{id}` in the next call — has **no downstream type to
  infer**, so today core emits the non-generic `ExtractFieldFromResponse` (untyped). **Decision (user,
  2026-07-25):** the next class does NOT drive the type — the **user chooses it explicitly** from the
  dropdown (they read the next class's fields and pick), and core emits exactly that. Build the spec
  below.
  - **Type selection is required at GENERATE, not before (user, 2026-07-25):** the picker starts
    **unselected** (no silent `string` default); nothing is generated on selection. When the user
    presses Generate, an unset type **blocks generation** with an actionable message. (This overrides
    the "`string` (default)" wording in the original brief below — default is *unset*, enforced at
    generate.)
  - _Superseded DROP note (2026-07-23), kept for context — why the drop was wrong:_ the drop assumed
    VS Code's OUT capture always converts to a method step whose `ExtractField<T>` type is inferred by
    the `varTypes` look-ahead. That inference does not fire for the URL-placeholder sink, which is the
    primary capture pattern.
  - **What clients rely on instead (keep exported + working):** `takesFieldPath` — VS Code finds the
    extractor **by shape, never by name** (`extractMethodRef`), so a renamed or user-authored extractor
    still works. Changing that predicate breaks both builders.
  - **`E2ECaseItem.capture` stays in the DTO** for records saved before the change; nothing generates
    from it. If a client is ever pointed back at it, re-open this task rather than half-supporting it.
  - **Tell Desktop:** the matching Desktop `E2E-CAP` type picker is also unnecessary — see
    `../api2test/docs/TASKS.md`.
  - _Original brief, kept for context:_ **Bug found:** `generateTestForRow` does **not
  read `E2ECaseItem.capture` at all** — `classStep` emits the class call but never declares the capture
  variable, so a class-first chain (capture `id`→`orderId`, then use `orderId` in a later step's URL
  `{id}`/override) generates code that references an **undeclared variable** and won't compile. The
  typed-extraction machinery (`ExtractField<T>` + the `csTypeOf` look-ahead) exists **only** on the
  method-based `ExtractField` step, not on the class-first `capture`. (Verified: all 4 `capture` mentions
  in `E2ETestGenerationService.ts` are comments; a two-step capture→delete chain declares `orderId`
  nowhere.)
  - **Decision (user, 2026-07-19): the capture carries an explicit, USER-CHOSEN type** (a small scalar
    dropdown in the builder), rather than inferring it from the downstream field. So core doesn't need
    the look-ahead for this path — it emits `ExtractField<T>` straight from `capture.type`.
  - **Type list (edition-agnostic UI, one `number`):** `string` (default), `number`, `bool`/`boolean`,
    `Guid`. **No `object`/`array`** (captures feed URL `{}` parts and simple fields). **`number` maps to
    C# `decimal`** (holds large integer ids exactly — unlike `double` past 2^53 — and renders cleanly
    into URLs: `123`, not `123.0`); TypeScript `number`.
  - **Core work:** (1) add `type?: string` to `E2ECaseItem.capture` (`models/E2EDto.ts`); (2) in
    `classStep`, after the class call, emit the extraction into the capture variable, typed by
    `capture.type` (default `string`), mapping `number`→`decimal` for C# and `number` for TS; (3) the
    read must be tolerant of a JSON value that comes back as a **number OR a string** and render it
    safely (spec: extract the raw JSON element and `.ToString()` rather than a strict `GetString()` that
    throws on a number) — the common case is a scalar going into a URL part. Do the TS emitter half too
    (`generateE2ETestTypeScript`). Bug-first: a capture→use chain must (a) declare the variable and
    (b) declare it with the chosen type; shown failing on today's generator (undeclared), then passing.
  - **Adoption:** VS Code adds the scalar type picker to the OUT capture row + persists `capture.type`
    (paused until this lands — the picker generates nothing today; **enforce "type required" at
    Generate** client-side per the 2026-07-25 decision); Desktop adds the same picker
    (see `../api2test/docs/TASKS.md`). VS Code review-batch reference: **RB-5** (`../Api2TestVS/docs/TASKS.md`).
- [ ] **E2E-MODEL-1 (optional, later) — unified TestCase model + store rule.** Core has the E2E
  building blocks (`E2ECaseItem`, `generateTestForRow`) but **no unified `TestCase { items[], header,
  status }` wrapper or store rule** — Desktop keeps it in the client, and VS Code is adding its own for
  path A (E2E-A1). If a second edition needs it, lift the wrapper type + Steps/Generated derivation
  here (parameterised by `StorageProvider`), same pattern as the ORCH/LIC lifts. Not blocking anything
  today — filed so the duplication is visible.

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
