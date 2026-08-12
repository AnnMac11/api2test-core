# API2Test core (shared engine) — running task list

> **This file is the durable source of truth for open core tasks.** The in-session task tracker and
> background "chips" do NOT survive a new thread — this file does. Read it at the start of a session,
> append the moment a task is agreed, tick items off (don't delete) as they're done, and update it
> before ending a session. See `CLAUDE.md` → "Task tracking". _Created 2026-07-13._

Core is consumed by both the Desktop app ([`../api2test/docs/TASKS.md`](../../api2test/docs/TASKS.md))
and the VS Code extension ([`../Api2TestVS/docs/TASKS.md`](../../Api2TestVS/docs/TASKS.md)). Changes
here affect both editions — note the coordinated version bump on any task that ships.

## Open

- [x] **SEND-1 / NAME-1 — a GET step generated code that could not compile, and the method names did not
  say what they do. DONE 2026-08-08 (branch `develop`, uncommitted).** Found by the user: generated test
  `test5` failed with
  `CS1503: cannot convert from 'object' to 'System.Net.Http.HttpResponseMessage'` at both follow-up lines.
  - **Root cause (SEND-1) — one send helper had a different contract from all the others.** The curated
    C# `GetAsync` returned `Task<T>` (the deserialised body), while every validator and extractor takes an
    `HttpResponseMessage`. So a GET step could never be followed by anything. TypeScript's `get` already
    returned the response — evidence the response-returning shape is the intended one. Fixed in the
    curated C# **and** Python library bodies (`GetAsync` → `Task<HttpResponseMessage>`) and in the emitter,
    which now emits `await GetAsync(token, url)` with no `<object>` and records the GET response as
    capturable (E2E-CAP-GET).
  - **Root cause (NAME-1) — the names described the mechanism, not the usage.** Renamed across all three
    seeded libraries (`csharp` / `python` / `typescript`):
    `ExtractFieldFromResponse`→`ExtractFieldAsync`, `ExtractTokenFromResponse`→`ExtractToken`,
    `ParseJsonResponse`→`ExtractBodyAs`, `DeleteByParamAsync`→`DeleteByPathValueAsync`,
    `PostMultipartAsync`→`UploadFileAsync`, and every validator now carries its status codes:
    `ValidateSuccess_200_201Async`, `ValidateDeleted_200_204Async`, `ValidateBadRequest_400Async`,
    `ValidateUnauthorized_401Async`, `ValidateForbidden_403Async`, `ValidateNotFound_404Async`,
    `ValidateConflict_409Async`, `ValidateValidationError_422Async`; the app helpers became
    `PetStoreBaseUrl` / `PetStoreApiKey` / `StripeBaseUrl` / `StripeSecretKey`.
  - **No data migration.** The stored library is matched by stable `id` first (REFRESH-1), so a curated
    rename replaces in place. Saved E2E cases *do* store method names (`item.ref`, `page.token`), so
    `canonicalMethodName(ref)` + `LEGACY_METHOD_NAMES` translate a pre-rename name **at generation time**
    in both emitters. `friendlyMethodName` lost its hand-written `METHOD_LABELS` table — the name is now
    the label (minus `Async`), so the two can no longer drift.
  - **Bug-first.** The gap that let this ship: TypeScript had a `tsc` compile guard, C# had none, so a
    compile error passed a green string-matching suite. New `test/e2eCSharpCompile.test.ts` emits the
    shipped seed as `ApiMethods.cs` plus a generated chain and runs the real `dotnet build` (skipped, not
    failed, with no .NET SDK). Evidence: emitter reverted → CS0308; library `GetAsync` reverted → CS0411;
    both reverted → **the user's exact CS1503 at two lines**; fixed → builds. Suite: 289/289.

- [x] **CLS-7 — a class must be built from its ENDPOINT's schema, not from a dictionary link. DONE
  2026-08-08 (branch `develop`, uncommitted).** Found by the user in the VS Code Test Case builder.
  Symptom: `PetStorePlaceOrder`
  (POST `/store/order`, a six-field body) has **0 fields**, so the builder's `In · overwrite fields`
  says *"No request fields on this class"* and re-generating writes nothing at all
  (`renderClassCode` finds no body fields and no URL params → `null` → outcome `empty`, silently).
  Verified against the user's live store (`~/.vscode/API2Test/data`).
  - **Root cause — the field↔endpoint link is 1:1 but the relationship is many-to-many.**
    `extractFieldsFromEndpoint(ep, true)` de-duplicates **by field name across the whole dictionary**
    and each row stores a single `sourceEndpointId`, so every placeOrder field had already been
    claimed by an earlier PetStore endpoint (`id`/`status`→addPet, `petId`→deletePet,
    `quantity`/`shipDate`/`complete`→getOrderById). `importApi` then passes `addClass` only the
    newly-added `matched` set ([DictionaryImportService.ts:86](../src/services/DictionaryImportService.ts:86)),
    which was empty. `resyncClassFields` re-pulls by `sourceEndpointId` and has the same hole.
  - **Decision (user, 2026-08-08): copy the values, do NOT link.** *"why don't you create a class
    using the values to the data dictionary. do not link them. as any change to the dictionary might
    kill the class."* The class already stores a value snapshot; only the population step is
    link-based. New `fieldsForEndpoint(endpoint, dictionary)`: fields come from the endpoint's own
    `requestBodySchema` + `parameterDetails`; each field's settings (type, mandatory, `dataMethod`,
    args) are resolved from the dictionary **by name**, whoever imported it first, defaulting to
    `NOT_ASSIGNED`. No `sourceEndpointId` filter anywhere in the class path.
  - **Callers to move onto it:** `addClass`/`importApi` (stop passing the `matched` subset) and
    `resyncClassFields`. The refresh should also re-take `endpoint`, `method`, `contentType` and
    `requestBodySchema` from the endpoint — the spec may have been re-imported, not just the
    dictionary edited.
  - **Surface `empty`.** A class with nothing to emit currently produces no file and no message.
  - **Implemented:** new `DataDictionaryService.fieldsForEndpoint(endpoint)` — extraction with
    de-duplication OFF, then the dictionary's `dataMethod`/args copied in **by name** (the row whose
    type matches wins where a name has several); type, mandatory and location stay the endpoint's,
    since two endpoints may legitimately disagree about a shared name. `importApi` now passes its
    result to `addClass` instead of the `matched` subset, and `resyncClassFields(id, endpoint?)`
    rebuilds through the same path — signature changed from `(id, dictionaryFields)`, and with an
    endpoint supplied it also re-takes `method`/`endpoint`/`contentType`/`requestBodySchema`. With no
    endpoint (source deleted — a class outlives its source by design) it refreshes from the entry's
    own stored schema.
  - **Bug-first.** The guard that should have caught this was `dictionaryImport.test.ts`'s dedup test:
    it asserts the tally on a re-import but never looks at the class that was written — it even
    remarks "ep2 shares the same schema so it dedups to 0" without checking the consequence. New CLS-7
    test imports `addPet` then `placeOrder` (the user's real schemas) and asserts placeOrder's class
    holds all six of its own body fields: RED `['complete','petId','quantity','shipDate']` — `id` and
    `status`, the two shared names, missing — GREEN after. `classFieldResync.test.ts` was rewritten:
    its old assertions pinned the `sourceEndpointId` filter in place, so it is the test that must
    change (it now proves the assignment is copied from a row owned by a *different* endpoint), plus
    new cases for a field with no dictionary row and for a deleted endpoint. **284/284, tsc clean.**
  - **Verified against the user's live store** (a copy of `~/.vscode/API2Test/data`):
    `PetStorePlaceOrder` goes from **0 fields → 6** (`id`, `petId`, `quantity`, `shipDate`, `status`,
    `complete`) with `RandomId`/`ParameterInt`/`Quantity`/`PetStatus` copied across by name;
    `shipDate` and `complete` stay Not Assigned because their dictionary rows genuinely are.
  - **Both editions.** Desktop consumes the same call and ships the same defect. Client adoption:
    VS Code **RB-26/RB-27**; `resyncClassFields`'s second argument is now the endpoint, not the
    dictionary.
- [x] **SEED-5 — DateOfBirth returns DateOnly (user decision 2026-08-05). DONE 2026-08-05 (branch
  `develop`).** Was `DateTime` — a birth date carried a time component and, subtracting whole years
  only, always landed on today's month/day. Now `DateOnly` (C# `DateOnly.FromDateTime(...)`, Python
  `.date()`) with a random 0–364 day offset; `typeClass('dateonly')` already buckets as date, so
  matching is unchanged. Bug-first SEED-5 test in
  [test/defaultLibraries.test.ts](../test/defaultLibraries.test.ts) failed on `DateTime`, passes
  now; suite 281/281.
- [x] **REFRESH-1 — refreshDefaults couldn't propagate a curated RENAME (defect, found by the user
  2026-08-05). DONE 2026-08-05 (branch `develop`).** Matching was by name key only, so a SEED-3
  rename left the old-named shipped copy in place AND appended the new name — an existing install
  got `GetDateStr` + `DateStr` duplicates. Now matches shipped copies by stable `id` first, name
  second (custom items never id-match). Bug-first in
  [test/seedRefresh.test.ts](../test/seedRefresh.test.ts): rename case failed
  (replaced 0/added 1/duplicate) before, passes after; full suite 280/280. Verified against the
  real VS Code store: 6 replaced in place, 2 added, 100 total, no old names.
- [x] **SEED-3 — rename curated Data Library methods for alphabetical order + casing. DONE
  2026-08-05 (branch `develop`).** Bug-first: new SEED-3 test in
  [test/defaultLibraries.test.ts](../test/defaultLibraries.test.ts) failed 4 on the old seeds
  (renames + counts), passed after; ids 13/14/15 asserted stable for `refreshDefaults`. Full suite
  278/278. TS seed has none of the rename targets (15-method set) — renames applied to
  csharp + python only. Raised from
  the VS Code Stripe-import review 2026-08-05. The grid sorts A–Z (`sortDataMethodsByName`), so the
  `Get` prefix strands the date methods under G, and the two lowercase Twilio names break the
  PascalCase convention. Renames (agreed): `GetDate`→`DateNow`, `GetDateStr`→`DateStr`,
  `GetDateTimeStr`→`DateTimeStr`, `twilioToken`→`TwilioToken`, `twilioSID`→`TwilioSid`,
  `Percentage`→`Percent` (bonus: Stripe's `application_fee_percent` then auto-matches via the
  contains tier). Apply in **all 3 language seeds** (`src/data/libraries/{csharp,typescript,python}/
  data-library.json`), **keep the stored ids** so SEED-1's `refreshDefaults` propagates the rename to
  existing stores. Re-review task filed in Api2TestVS (SEED-ADOPT-1); Desktop picks it up via the
  same refresh.
- [x] **SEED-4 — add two curated Data Library methods (deliberately minimal). DONE 2026-08-05
  (branch `develop`, with SEED-3).** `RandomInt` (id 99) + `UnixTimestamp` (id 100, returnType
  `long`) added to all 3 language seeds; SEED-4 test failed before, passes after; data-library
  count 98→100. Raised with SEED-3.
  Decision: do NOT add per-field Stripe methods (TrialPeriodDays, UnitAmount, enum generators, …) —
  generic methods + user-picked values cover them. Add only: **`RandomInt(min:int, max:int)`**
  (generic int — covers `trial_period_days`, `days_until_due`, `unit_amount`, any ranged int) and
  **`UnixTimestamp`** (epoch seconds — Stripe date fields `created`, `cancel_at`,
  `billing_cycle_anchor`, `backdate_start_date`, `trial_end`). All 3 language seeds.
- [ ] **MATCH-1 — `*Object` methods declare `returnType: string`, causing a wrong match and a missed
  match (defect).** Found on Stripe import 2026-08-05: (a) Stripe's `object` field (a string literal
  discriminator like `"list"`) auto-matched **LocationObject** — the method returns `string`, so it
  sits in the string bucket and its `Object` word hits tier-3 reverse-contains; (b) `metadata`
  (object field) is left Not Assigned even though **MetadataObject** exists — same root cause, the
  method is filtered out of the object bucket before name matching. Decide: retype the `*Object`
  seed methods to a real object return, or teach the matcher. Bug-first test in
  `test/matching.test.ts` per protocol.
- [ ] **TYPE-1 — a captured value assigned to a typed field doesn't compile (CS0266), and the fix has to
  work for all three languages.** Raised from VS Code 2026-08-03, hit as a **real compile error** the
  first time Execute actually built the sandbox (RB-22): a 3-step PetStore chain captures `id` from
  `AddPet` and pins it onto `PlaceOrder.PetId`, generating

  ```csharp
  var petid = await ExtractFields<decimal>(response1, "id");
  var request2 = new PetStorePlaceOrder() { PetId = petid };   // error CS0266: decimal → int?
  ```

  **Two causes, both in this repo** (corrected 2026-08-03 while fixing — the original write-up blamed
  `overrideValue`, which turned out to be innocent; the machinery to prevent this already existed and was
  simply broken):
  1. **`emitCaptures` never consulted the destination type.** It typed the capture purely from the
     store-as pick (`mapCaptureType(c.type, 'csharp')` — `number` → `decimal`, chosen to hold large ids
     exactly) while the destination was whatever the spec declared, here `int?`. Nothing reconciled them.
  2. **The look-ahead that knows the destination was silently dead.** `state.varTypes` maps each captured
     variable to the type of the field it later feeds — but it passed the **raw spec key** (`petId`) to
     `csTypeOf` against a class declaring `PetId`. C# is case-sensitive, so it always resolved to
     `'string'` and was then discarded by the `!== 'string'` guard. This is the same **OVR-CASE**
     mismatch fixed in `classInitializer` and never applied to the look-ahead.

  **FIXED for C# 2026-08-03** (steps 1–4 below still open — they are the portability work):
  `emitCaptures` now prefers `state.varTypes.get(variable)` over the store-as pick, and the look-ahead
  uses `csPropertyName(prop)`. With no typed destination the user's pick still governs. Bug-first tests in
  [test/overrides.test.ts](../test/overrides.test.ts): the pinned case failed with `ExtractFields<decimal>`
  before the fix and now emits `ExtractFields<int?>`; a companion test guards that an unconstrained
  capture keeps `decimal`. Full suite 262/262.

  **Known limit of the C# fix:** `varTypes` is a flat map, so one variable pinned onto **two different**
  field types keeps only the last. That is what step 3 (`coerce`) exists to solve properly — convert at
  the assignment instead of retyping the capture.

  **Blocker for PY-1 — `csTypeOf` finds the destination type by regexing the generated C# source**
  (`public\s+(Type)\s+Prop`, [E2ETestGenerationService.ts:43](../src/services/E2ETestGenerationService.ts:43)).
  That is unportable by construction: it cannot work for Python and barely works for TypeScript. Any fix
  built on it is C#-only.

  **Fix, in dependency order:**
  1. **Read the destination type from the class model, not the emitted text** — `ApiClassLibraryFieldDto`
     already carries it, language-neutrally. Everything else depends on this.
  2. **Expose a per-language display type**, so a client can show the user the type the generated code
     will actually declare — `int?` (C#) / `number` (TS) / `int` (Python) — for a request field, a
     response field, and a path placeholder alike. The per-language maps already exist
     (`ClassGenerationService` for C#, `generateRequestClassTypeScript` for TS); this only needs one
     exported entry point over them. **The language is fixed at first run and cannot be changed
     afterwards** (user, 2026-08-03), so the concrete type can be stored as well as displayed — there is
     no later language switch to invalidate it. Clients enforce that lock; see VS Code **RB-24**.
  3. **Add `coerce(expr, fromType, toType)` to the `CodeEmitter` interface.** Core compares the two
     **abstract** types and decides a conversion is needed; each emitter renders it — C# `(int?)x` /
     `x.ToString()` / `int.Parse(x)`, TS `Number(x)` / `String(x)` (usually a no-op), Python `int(x)` /
     `str(x)`. Language knowledge stays in the adapters, where the rest of it already is.
  4. ~~**Own `CAPTURE_TYPES`.**~~ **DONE 2026-08-03 as CAP-TYPE** (see Done) — core now owns the list as
     `captureTypes(language)`, keyed by language rather than abstract, and VS Code's copy is deleted.
     Desktop still has its own (`ui-browser/.../logic/captureRows.ts:30`) — adoption goes with **CAP-CORE**.

  **Bug-first test:** generate the PetStore add-pet → place-order chain with the id captured as `number`
  and pinned onto an `int?` field, and assert the emitted assignment converts. **Done for C#** (see FIXED
  above). Repeat per language once the emitter seam is in.

  **Edition impact:** Desktop generates through the same service and ships the identical defect — any
  test case that threads a captured id into a typed field fails to build there too. It has simply been
  invisible in VS Code until now, because Execute never actually compiled anything (RB-22).

  **Paired re-review task** in `../Api2TestVS/docs/TASKS.md` under **RB-23**.

- [ ] **CAP-CORE — the OUT-capture row logic is duplicated in both editions; lift it here.** Raised by
  the user 2026-08-03 while filing **TYPE-1** ("create a task to remove the duplicate methods, and fix in
  the core"). TYPE-1 step 4 covers only the `CAPTURE_TYPES` list — the whole module is duplicated, under
  **different names**, which is why the drift has gone unnoticed:

  | Desktop `ui-browser/.../logic/captureRows.ts` | VS Code `src/webviews/e2eBuilderData.ts` |
  | --- | --- |
  | `CAPTURE_TYPES` (:30) | ~~`CAPTURE_TYPES`~~ — lifted here as `captureTypes(language)` (CAP-TYPE, 2026-08-03) |
  | `migrateCaptures` (:65) | `collapseCaptures` (:254) |
  | `validateCaptures` (:107) | `captureTypeError` (:244) |
  | `captureIncomplete` / `stepCapturesIncomplete` (:33, :38) | folded into `captureTypeError` |
  | `CaptureRow` (:18) | inline on `E2ECaseItem` |

  Same rules in both — a row is incomplete without a variable and a type, a legacy single `capture`
  migrates to a typed OUT row, Generate blocks while any row is untyped. Two implementations means a fix
  to one is a silent regression in the other, and **Python would make a third copy**.

  - **Fix:** one `captureRows.ts` here, keeping the clearer name from each pair, exported through the
    package index. Both editions delete their copy and import it. The store-as list goes with it
    (TYPE-1 step 4 — do these together, they touch the same lines).
  - **Watch for real divergence while lifting**, don't paper over it: VS Code's `collapseCaptures` takes
    a `methodParams` map and folds a legacy `ExtractFieldFromResponse` **method step** back onto its
    class; Desktop's `migrateCaptures` has the same signature but the two have been maintained
    separately. Diff the behaviour before picking one — the surviving version must handle every case
    both did, and the migration path is what opens a user's existing saved test cases.
  - **Bug-first test:** a case saved under the legacy single-`capture` shape opens with a typed OUT row,
    asserted once here, replacing the two per-edition tests
    (`../api2test/tests/unit/captureRows.test.ts`, `../Api2TestVS/src/test/suite/e2eBuilderData.test.ts`).
  - **Edition impact:** both editions delete code; neither changes behaviour. Paired re-review tasks:
    VS Code **RB-25**, Desktop **E2E-CAP-LIFT**.

- [x] **DONE 2026-08-10 — see the Done section.** ~~APP-ID-IMPORT — import never sets
  `applicationId`, so imported data is name-linked only.~~

- [ ] **APP-SCOPE-2 — app scoping helpers for the Test Cases page (classes + sole-app default).**
  Raised from VS Code 2026-07-29 (RB-10: put a Desktop-style application selector on the Test Cases
  page). `methodScope.ts` scopes **methods** by app id, but the same page needs to scope **classes** to
  the selected app and to auto-select when the user has exactly one app — Desktop does both inline in
  `TestCasesPage.tsx` (`sameApp`, `soleApplication`), so the rule is duplicated per edition and will
  drift.
  - **Fix:** lift `sameApp`/`soleApplication` and a class-by-app filter into `methodScope.ts` (or a
    sibling `appScope.ts`), preferring `applicationId` with a name fallback — and depending on
    **APP-ID-IMPORT** for the id to actually be there.
  - **Edition impact:** Desktop deletes its local copies; VS Code consumes rather than re-implements.
- [ ] **RB-6/CORE — the shipped demo applications don't use the ids the seeded methods link to.**
  Raised from VS Code 2026-07-29. `resources/data/applications.json` numbers its demo apps `1..4`, but
  the curated `src/data/libraries/*/api-method-library.json` links methods to `applicationId`
  `"app-petstore"` / `"app-stripe"`. Nothing resolves: on a clean install the app-scoped base-path and
  token dropdowns (APP-1 `basePathOptions`/`tokenOptions`) come up empty for PetStore and Stripe,
  because the filter matches on `applicationId`.
  - **Fix:** give the shipped applications the same stable slug ids the seed already uses
    (`app-petstore`, `app-stripe`, and slugs for the rest) — the seed library is the harder thing to
    change, so the apps move. Positional ids re-number as apps are added/removed and will break the
    links again.
  - **Bug-first test:** assert every `applicationId` on a seeded API method resolves to a shipped
    application, reading the real seed + real applications file (not hand-made rows). The equivalent
    test in VS Code (`src/test/suite/shippedAppIds.test.ts`) shows the shape; core's existing
    `defaultLibraries.test.ts` is the natural home.
  - **VS Code already fixed its own copy** (2026-07-29, branch `sp1-1-deploy-via-core`) so the extension
    isn't blocked. **Paired re-review task** is filed in `../Api2TestVS/docs/TASKS.md` under RB-6:
    on the next core delivery, re-verify the two seeds agree and drop any VS Code-side divergence.
  - **Edition impact:** Desktop ships the same seed → same empty dropdowns on a clean install.
- [x] **APIM-SEND-1 — complete the send-method matrix (verb × content-type). DONE 2026-07-25 (`develop`).**
  Prep for `E2E-SEL-1`'s `chooseSendMethod`: a form-encoded PUT, and PATCH (json + form), had no library
  method to select (only `PostForm`/`PostJson`/`PutJson` existed). Added **`PutFormAsync`,
  `PatchJsonAsync`, `PatchFormAsync`** to all 3 seed api-method libraries (csharp/typescript/python),
  matching each language's existing helper style (`Reporter.Record`/`reporter.record`, Bearer + Accept
  json, correct Content-Type). Content-type is already tagged per class (`ApiClassLibraryDto.contentType`,
  set at import from the spec — OpenAPI json vs Postman form header — and read via `isFormEncoded`), so the
  selector keys off verb + that. Seed counts 23→26; `test/defaultLibraries.test.ts` count pins updated +
  a new test asserts the three exist in every language. **227/227 green, build clean.**
- [x] **RB-1 / RB-3 — data-method matching + display order lifted to core. DONE 2026-07-25 (`develop`).**
  New `services/dataMethodMatching.ts` (exported from `index.ts`) is the single source for field↔method
  matching: `typeClass` (the fine 6-bucket classifier — `DataDictionaryService`'s private duplicate is
  **deleted**, it now imports this one), `coarseKind`, `dataMethodKindLabel`, `orderDataMethodsForField`
  (**RB-1**: matching-kind methods first, then every other method — nothing hidden — each group A–Z,
  labelled `Name (kind)`; input not mutated) and `sortDataMethodsByName` (**RB-3**: Data Library grid A–Z).
  Bug-first: `test/dataMethodMatching.test.ts` — 2/6 shown **failing** on pre-fix stored-order, then green.
  **224/224 green, `tsc` build clean** (auto-match unregressed). VS Code's local RB-3 sort was rolled back;
  both editions now adopt the core helpers (VS Code `getDataMethodOptions.kind()` drop + Desktop lift).
- [x] **RB-4 (core piece) — class-field re-sync in `ApiClassLibraryService`. DONE 2026-07-25 (`develop`).**
  New `resyncClassFields(id, dictionaryFields)`: re-pulls the class's fields from the current Data
  Dictionary (filtered by `sourceEndpointId === entry.endpointId`), rebuilds the stored snapshot and
  persists — a **full re-sync** (assignment updated, new field added, removed field dropped). Per the
  user's "reuse, don't add functionality" decision it shares the exact add-class population path — the
  field-mapping was extracted to a private `toClassFields` used by both `addClass` and the re-sync; no
  diff/merge logic. Returns the updated entry (`undefined` on unknown id). Bug-first:
  `test/classFieldResync.test.ts` shown **failing** on a no-op re-sync, then green. **226/226, build clean.**
  - **Adoption (clients):** the "Update & Generate" button = call `resyncClassFields` with
    `getDataDictionary()`, then run the existing generate. Tabbed Edit-Class + Code tab is client UI only.
- [x] **Dependabot npm PRs — DONE 2026-07-25 (applied on `develop`, verified one at a time).** All green,
  build clean + `npm test` 215/215 after each. Commits `e4fa193` (low-risk trio + CI Node) and `e7b1b39`
  (TS 7). GitHub PRs #6/#9/#10/#11/#12 target `main` and are **superseded** — close them (or let the
  `develop`→`main` merge close them); nothing left to merge from them.
  - **TypeScript 5.9 → 7.0.2** (#9): the native TS 7 compiler broke the build (28 errors) — root cause was
    TS 7 not auto-scanning `node_modules/@types`; fixed at root with `types: ["node"]` in `tsconfig.json`
    (no-op under TS 5, `@types/node` is the only `@types` dep). Not a workaround.
  - **@types/node 20 → 24** (NOT Dependabot's 26): types track the runtime, not run ahead of it. Pinned to
    `^24` to **match** the CI Node bump. 26 is ahead of every released LTS (would compile against
    non-existent APIs).
  - **CI Node 20 → 24 + `actions/setup-node@v6→v7`** (#11): Node 20 is EOL (~April 2026); moved
    `ci.yml` to the active LTS (24). This was the "decide the build Node version" open question — resolved.
  - **tsx 4.19 → 4.23.1** (#12) and **rimraf 5 → 6.1.3** (#6): low-risk, clean.
- [x] **#52 — integer ids typed as `decimal`. DONE 2026-07-25 (guard added; already functionally fixed).**
  The code was already correct at both hops — `DataDictionaryService.mapTypeToFieldType`/`getFieldType`
  keep `integer` distinct from `number`, and `ClassGenerationService.getCSharpType` maps `integer`→`int`,
  `number`→`decimal` (both carry #52 comments; fixed in an earlier session, never closed here). The real
  gap was **no test pinned the CONCRETE generated property type** — the extraction side was covered
  (`extract.test.ts`) but not the output. Added `emitter.test.ts` "#52: an integer field generates
  `public int`, a fractional number `public decimal`". Bug-first: shown **failing** by temporarily
  regressing `getCSharpType` (`integer`→`decimal`) — error "integer → C# int, not decimal" — then green
  after restore. **215/215 green**; no `src` change (guard-only), so no `dist` rebuild. Closes the Desktop
  Phase-1 mirror.
- [x] **Audit engine test assertion depth — DONE 2026-07-25.** Read-across of all 36 `test/*.test.ts`:
  the suite is strong (most generator/emitter tests pin exact emitted code and `tsc --strict`-compile it).
  Found the C# generator tests were shallower than their TS twins and deepened the 3 real gaps, each
  proven bug-first (tightened assertion shown **failing** on a deliberately-broken emitter, then green):
  - `emitter.test.ts` "data-method default": was `match(/class/)` + `match(/Email/)` (token anywhere) →
    now pins `public string Email { get; set; } = new DataGenerator().Email();`. Proof: dropped the
    initializer in `ClassGenerationService.dataCall` → red.
  - `testGeneration.test.ts`: added "POST body pins the wrapper call + request-body construction" — the
    namespace test never touched the call site. Pins `var requestBody = new PetStorePostPet().ToJson();`
    and `await ApiMethods.GetAsync(token, url, requestBody)`. Proof: swapped arg order → red.
  - `emitter.test.ts` TS-adapter test: was `doesNotThrow` only → now pins `export class ApiMethods` /
    `export class DataGenerator` (catches an empty/wrong delegation a `doesNotThrow` would pass). Proof:
    adapter `return ''` → red.
  **216/216 green, build clean, src unchanged (test-only).**
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
- [x] **PY-1 — Python emitters + pytest runner. DONE 2026-08-12 (branch `develop`).** Emitters
  delivered under PY-GEN-1 (same session). Runner half in `TestRunnerService.ts`, parallel to the
  dotnet/Vitest paths: **`parseJUnitXml`** (pytest `--junit-xml` → `RawTestResult[]`; JUnit keeps stdout
  per testcase, so `##A2T_CALL##` markers attribute per test for free — no custom reporter like TS-C2),
  **`runPyCompile`** (`python -m compileall -q`, stdlib-only so missing `requests`/`faker` can't fail
  validation) and **`runPytest`** (`python -m pytest -q --junit-xml … -o junit_logging=out-err`, `-k`
  filter) returning `PytestRun { results, calls }`. `BUILD_VALIDATORS.python` wired in `deployUnit.ts`;
  all exported from `index.ts`. Bug-first: `test/pytestRunner.test.ts` RED first — and it caught a real
  bug (`name=` attr regex matched the tail of `classname=`; anchored). Live-pytest test skips when
  pytest is absent; `runPyCompile` runs against the real interpreter.

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
- [x] **CLS-5 — re-export `RagStatus` from the core `index`. ALREADY SATISFIED — verified 2026-07-25.**
  The premise is stale: `RagStatus` **is** reachable from the package index today, via
  `index.ts` `export * from './models'` → `models/index.ts` `export * from './classStatus'` (the barrel
  added with CLS-2). Verified with a `tsc --noEmit` consumer: `import type { RagStatus } from
  'api2test-core'` compiles with **no** explicit re-export line. So the VS Code `ApiClassLibraryDto['status']`
  workaround was unnecessary — both editions can `import { RagStatus }` from the index now. Adding an
  explicit `export type { RagStatus }` would be pure redundancy (barrel already covers it), so nothing was
  changed. _Original note below._
  `rollupRag`/`resultToRag` are exported from `index.ts`, but the **`RagStatus` type is not** — it's only
  reachable via `models/classStatus`. VS Code worked around it with `ApiClassLibraryDto['status']` indexed
  access, but both editions want the named type. One line: `export type { RagStatus } from './models/classStatus';`
  (or add it to the existing `classStatus` re-export). Trivial; do on the next core touch.
- [x] **CLS-6 — lift the class-generation-state DERIVATION into core (both editions derive it). DONE
  2026-07-25 (branch `develop`).** New `deriveClassState(entry, hasCode)` in `services/classStatus.ts`
  (exported from `index.ts`): `error` if `generationError` set (wins even over a stale class file), else
  `generated` when `hasCode`, else `pending`. **Vocabulary reconciled onto the batch
  `ClassGenerationState` (`generated|pending|error|empty`)** — user decision 2026-07-25: canonical word
  set is the batch outcome's (core already owns it). The clients' `failed` folds into `error`; `empty`
  (no body) is a batch-time distinction only, never derivable from `(entry, hasCode)`, so the function
  never returns it. Colours stay client-side. Bug-first: `test/classStatus.test.ts` case (pending/
  generated/error-wins) shown **failing** (`deriveClassState is not a function`), then green. **214/214
  green, build clean, `dist` rebuilt.**
  - **Adoption (clients):** VS Code replaces its local `utils/classStatus.ts` `classGenerationState`
    with core's `deriveClassState` (map its `failed` label → core `error`); Desktop CLS-4 uses it in
    place of deriving the same. _Original note below._ Core owns the transient state as a BATCH outcome
    (`generateClassLibrary` → `.state`), but the rule to derive a **library entry's** display state on
    demand (not mid-batch) was duplicated in the clients.

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
  - **✅ Shared shapes DONE 2026-07-26 (`develop`, with EXEC-2):** `models/execution.ts` —
    `ExecResult` / `Execution` / `ExecResultStatus` + `ApiCall` (now single-sourced here; `TestRunnerService`
    imports it, so the runner and the report never drift). Exported via `./models`. Only the shapes; the run
    **primitives already in core** stay the shared engine (`runDotnetTest`/`runVitest`/`parseTrx`/
    `parseVitestJson`/`parseApiCalls` + `deployUnit`). What remains OPEN below is orchestration = edition-side.
  - **Orchestration stays edition-side:** each edition wires deploy→run→parse for its own environment
    (VS Code: workspace/project + Test Explorer, which it already does; Desktop: sandbox + CI). VS Code
    only needs the result types **if/when** it shows results in-app (otherwise it keeps the Test-Explorer
    hand-off). Bug-first applies where the orchestration lives (in the edition), not here.
- [x] **EXEC-2 — branded run-report HTML builder. DONE 2026-07-26 (`develop`).** Lifted Desktop
  `execution-suites/logic/runReport.ts` into core `services/runReport.ts` — `buildExecutionReportHtml(ex)`
  returns one self-contained, inline-styled HTML doc (print-to-PDF): header meta, summary band
  (totals/pass-rate/duration), and per-test breakdown with the full API call chain (verb/url/status +
  request/response bodies). Colours inlined (minimal result/method/status map), no DOM, no theme dep.
  Exported from `index.ts`. Bug-first: `test/runReport.test.ts` pins per-row status + call chain +
  HTML-escaping; RED shown by dropping the results render (3/3 fail) → GREEN. **239/239, build clean.**
  - **Adoption (clients):** Desktop drops its local `runReport.ts`, imports from core. VS Code renders the
    report from an `Execution` if/when it surfaces run results in-app (else keeps the Test-Explorer hand-off).

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
- [ ] **AGREED SPEC (user, 2026-07-25) — multi-row typed OUT capture, method `ExtractFields`.** Locks
  E2E-SEL-1 + E2E-CAP-1 together. Confirmed in-thread:
  - The OUT capture on a class step is a **list of rows**; the user adds one row per value to pull from
    the response (bounded by the number of values available).
  - Each row = **(1) response field · (2) variable name · (3) store-as type.**
  - The **type is a user-chosen conversion target** — how the value should be STORED for a later class
    whose field may want a different type — NOT the response's native type. The tool cannot infer it; the
    user decides. `ExtractFields<T>` converts the raw response value to `T`.
  - Generates **one typed line per row**, all reading the same `response`:
    `var orderId = await ApiMethods.ExtractFields<int>(response, "id");`
    `var orderStatus = await ApiMethods.ExtractFields<string>(response, "status");`
  - Extractor **renamed `ExtractField` → `ExtractFields`** (all 3 languages).
  - **Type required at Generate** — a row with an unset type blocks generation with an actionable message
    (no silent `string` default).
  - **SEL-1** auto-picks the send + extract method when a class is selected; the full method list stays so
    a **custom** method is still selectable (smart default, not a restriction).
  - Lives in **core** (row model + conversion + method + selection helpers); both editions call it.
  - Build order: C# reference path first (bug-first), then TS + Python, then SEL-1 helpers. Adopt in
    Desktop (drop client `extractRef`) + VS Code (RB-8).
  - **CORE DONE 2026-07-25 (C# + TS, uncommitted on `develop` pending VS Code validation):** `captures[]`
    on `E2ECaseItem`; `emitCaptures` in both C# (`E2ETestGenerationService`) and TS
    (`generateE2ETestTypeScript`) emits one typed line per row from THIS step's response; extractor
    renamed `ExtractField`→`ExtractFields` (C# `Convert.ChangeType`; TS runtime token conversion via
    `ApiMethods.extractFields`). **Semantic→language mapping** added as one shared helper
    `mapCaptureType(type, lang)` (`e2eCaseLogic.ts`): `number`→C# `decimal`/TS `number`,
    `bool`/`boolean`→`bool`/`boolean`, `Guid`→`Guid`/`string`, `string`→`string`, concrete types pass
    through. Bug-first tests: `e2eGenerator.test.ts` (asserts `<decimal>`/`<bool>`/`<Guid>` from semantic
    input), `e2eTypeScript.test.ts` (incl. `Guid`→`string`). **218/218 green, build clean.** _Remaining:_
    clients (VS Code RB-8/RB-5 multi-row typed OUT UI; Desktop drop `addOutputParam`→`captures[]`), then
    SEL-1 helpers, then Python (PY-GEN-1).
- [x] **PY-GEN-1 — Python E2E + API-method generator in core. DONE 2026-08-12 (branch `develop`).**
  Full Python emitter suite, mirroring the TS one file-for-file:
  - **`PythonEmitter`** (`src/adapters/PythonEmitter.ts`, wired in `emitterFor('python')` + the adapters
    barrel): `py` extension, `api_methods.py`/`data_generator.py` library names, `test_X.py` (pytest
    discovery) / `X.py` file names. All five emit kinds delegate to pure render functions.
  - **`generateApiMethodsPython`** — `api_methods.py` as a **module of functions** (matches the seed
    shape; not a class — that decision supersedes the original `ApiMethods`-class brief), on `requests`,
    with a `_Reporter` printing the same `##A2T_CALL##` markers `parseApiCalls` extracts (16 KB body cap,
    never raises). **`generateDataLibraryPython`** — `class DataGenerator` on `Faker`.
  - **`generateRequestClassPython`** / **`generateTestPython`** / **`generateE2ETestPython`** — request
    classes (`to_json`/`to_form_body`, PARAMETER placeholders, OVR-CASE via `setattr` for non-identifier
    JSON keys), single pytest tests (deploy-layout `sys.path` bootstrap + `Libraries`/`Classes` imports,
    f-string URLs, `urllib.parse.quote` on query args), and E2E chains (captures via 3-arg
    `extract_field_async`, `str()`-wrapped URL concat, override statements, `assert` validators).
  - **`pySymbol`** (`src/services/pyNaming.ts`) — PascalCase→snake_case keeping `_async`
    (`GetAsync`→`get_async`, `ValidateSuccess_200_201Async`→`validate_success_200_201_async`);
    `mapCaptureType(type, 'python')` → `float`/`bool`/`str` (`number`→`float` per the seed's typed
    extract; ids arrive via `as_type="int"` at the call site).
  - **Seed fixes** (`src/data/libraries/python/api-method-library.json`): `ExtractFieldAsync` now does
    what its description promised — `as_type` store-as conversion (`int`/`float`/`bool`/`str`), array
    indices in paths (`items[1].sku`), PASS/FAIL line on 200/201; `FormUrlEncode` now bracket-flattens
    nested dicts/lists.
  - **Bug-first:** `test/seedPython.test.ts`, `requestClassPython.test.ts`, `testPython.test.ts`,
    `e2ePython.test.ts` (+ `emitter.test.ts` additions) written first and shown RED (module-not-found +
    the seed extract runtime probe), then GREEN — including **runtime probes** that execute the emitted
    Python (`py_compile` + real interpreter with stubbed `requests`/`DataGenerator`) asserting captured
    values flow between steps. Full suite **346/347 green (1 skip: live pytest, not installed), build clean.**
  - **Adoption:** VS Code NF-1/SP-PY (see `../Api2TestVS/docs/TASKS.md`); Desktop picks it up whenever it
    exposes a Python target — both HANDOVERs note the lift (2026-08-12).
  - _Original brief (kept for context):_ Core
  today emits C# (`E2ETestGenerationService` / `generateApiMethodsCSharp`) and TS
  (`generateE2ETestTypeScript` / `generateApiMethodsTypeScript`); **Python has no generator at all** —
  `emitterFor('python')` throws. Net-new (NOT a "finish" item on the capture work). Scope:
  1. **`generateApiMethodsPython`** — render the API Method Library as `api_methods.py`: an `ApiMethods`
     class of static request wrappers (use `requests` or `httpx` — pick one, note it) that print the same
     `##A2T_CALL##` markers the runner (`parseApiCalls`) extracts, mirroring the C#/TS `Reporter`.
     Include the E2E-CAP-1 `extract_fields(response, field_path, as_)` with runtime store-as conversion
     (`number`→`float`/`int`, `bool`→`bool`, `Guid`/`string`→`str`) — reuse the semantic type list.
  2. **`generateE2ETestPython`** — turn one `E2ETestCaseRow` into a runnable **pytest** test: class-first
     model (send verb from the class's HTTP method), captured vars flow into later steps, validators
     assert. Mirror `generateE2ETestTypeScript` structure.
  3. **`mapCaptureType(type, 'python')`** — extend the shared helper (`e2eCaseLogic.ts`) with the Python
     column (`number`→`float`? confirm — Python has no `decimal` literal in the same way; likely `int`
     for ids or `float`; **decide with the user**).
  4. **Wire `emitterFor('python')`** + seed a `python` API-method library JSON
     (`src/data/libraries/python/api-method-library.json`) — the C#/TS ones already exist.
  5. Bug-first tests mirroring `e2eGenerator.test.ts` / `e2eTypeScript.test.ts`, compiling/running the
     generated pytest where practical.
  - **Edition impact:** Python is not consumed by VS Code (C#-only) or the current Desktop flows; it's a
    new language target. Confirm the consumer/edition before adopting. Lives entirely in **core**.
- [x] **E2E-SEL-1 — Edition-neutral extract/send method selection. DONE 2026-07-25 (`develop`).**
  Pure, UI-free helpers in `src/services/e2eMethodSelection.ts`, exported from `index.ts`:
  - `chooseSendMethod(verb, contentType)` → `GetAsync` / `DeleteAsync` / `Post|Put|PatchJsonAsync` /
    `Post|Put|PatchFormAsync` (form vs json via `isFormEncoded`); `''` for an unknown verb so the client
    shows no pre-selection. Depends on the send matrix completed by `APIM-SEND-1`.
  - `chooseExtractMethod(responseField, verb)` → a response field selected ⇒ `ExtractFieldFromResponse`
    (the `<T>` is NOT set here — it stays with the `E2E-CAP-1` capture-type picker, so method-choice and
    type-choice remain separate, per user 2026-07-25). No field ⇒ validate by verb: DELETE →
    `ValidateDeleteResponseAsync` (200/204), else `ValidateResponseAsync` (200/201 — covers GET 200 /
    POST 201). Both are **defaults only**; clients keep the full list.
  - **Sub-fix — TS validator parity (2026-07-25):** TS seed lacked `ValidateDeleteResponseAsync` (needed
    by the DELETE extract default) plus `Validate{Forbidden,Conflict,ValidationError}ResponseAsync`. Added
    all four so `chooseExtractMethod` resolves to a real method in every language (parity test + count pin
    22 in `defaultLibraries.test.ts`).
  - Bug-first: `test/e2eMethodSelection.test.ts` — RED shown for each (form-blind send, verb-blind extract)
    → GREEN. Full suite 236/236, build clean.
  - **Adoption:** VS Code **RB-8**; Desktop consumes in place of its client-side `extractRef`/auto-pick
    (both `HANDOVER.md`s, 2026-07-25). **NOT subsumed:** `chooseExtractMethod` returns the method name only,
    so the `E2E-CAP-1` manual type picker stays — build both.
  - _Original brief (kept for context):_
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
- [x] **LIC-6 — the licence PRESENTATION policy moves into core. DONE 2026-07-30.**
  `manager.ts` decided WHAT the access is; what the user is TOLD about it was still a VS Code copy
  (day counts, the 7-day warning threshold, the welcome/d7/d1 reminder schedule, the wording) — all
  commercial decisions Desktop would otherwise have reinvented and drifted from. New
  `src/licensing/presentation.ts` (pure, `now` injectable): `WARN_WITHIN_DAYS`, `daysUntil`,
  `accessDaysLeft`, `accessWarns`, `licenceSummary` → `LicenceSummary {text,hint,warn,canRemove}`,
  `nudgeFor` → `Nudge {key,message,kind}`, `describeAccess`; all exported from `index.ts`. Rendering
  stays client-side — core supplies the strings and the flags, the client decides status bar vs toast
  vs page section. New `test/licensePresentation.test.ts` (13, fixed `NOW`) pins the counts, the
  shared threshold, the once-only schedule, singular "1 day", urgency-beats-welcome, that an expiring
  **licence** says "licence ends" not "trial", and that `expired` nudges nothing. Build clean,
  **258/258 green**. Adoption: VS Code done same day (see `../Api2TestVS/docs/TASKS.md`);
  **Desktop still to adopt** — its licence panel duplicates this wording.

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

- [x] **IMPORT-HANG — RESP-SCHEMA made a real spec import never finish, and say nothing while it
  didn't. DONE 2026-08-10 (`develop`, uncommitted).** Reported the same day by the user, on the very
  next import: *"I tried to import stripe api via url, but it appears to be stuck. there is no error?"*
  - **Measured, not guessed.** The committed adapter takes **58 ms** on Stripe's 7.9 MB spec (589
    endpoints). With RESP-SCHEMA it **exhausted an 8 GB heap after ~140 s** and never returned. Nothing
    threw, so the dialog sat on "Importing…" indefinitely. The user's store confirmed it: an
    application row written, `api-methods.json` still 24 bytes.
  - **Cause 1 — the resolver is combinatorial.** `resolveSchemaTree` clones its cycle guard per branch
    (`new Set(seen)`), so the guard is per-*path*: a type reachable by k paths is expanded k times.
    Request bodies never exposed it (Stripe's are shallow form-encoded objects); response bodies are
    the full object graph, so RESP-SCHEMA turned a linear walk into an exponential one.
    **Fix:** `MAX_SCHEMA_DEPTH = 3` and `MAX_SCHEMA_NODES = 300`, threaded through every recursion.
    At a limit the node degrades to a bare `{ type }` — exactly what the cycle guard already emitted,
    so no caller needed changing. Depth 3 is what reads these trees: field (1) → items (2) → the
    element's members (3). Stripe now resolves in **99 ms / 5.7 MB** of response schema.
  - **Cause 2 — the import wrote the file once per endpoint.** `importFromAny` looped `addItem`, which
    re-reads and re-serialises the whole collection each call: 589 rewrites of a file growing to ~8 MB.
    Quadratic, and it was there before RESP-SCHEMA — that change just made each row 4× bigger.
    **Fix:** read once, map all, `writeJsonFile` once.
  - **Cause 3 (found in passing, same file) — `baseUrl` was misparenthesised.** `spec.servers?.[0]?.url
    || spec.host ? … : ''` binds `||` tighter than `?:`, so **every OpenAPI v3 import** produced
    `https://undefined/v1/customers`. Fixed, along with the trailing slash Stripe declares on its
    server URL (`https://api.stripe.com/` + `/v1/customers` gave a doubled slash).
  - **Bug-first:** new `test/schemaExpansionBounds.test.ts` (dense cross-referencing spec — **471 KB for
    one endpoint / 28.8 MB for 61** before, bounded after) and `test/importWriteCost.test.ts` (**200
    writes for 200 endpoints** before, 1 after). The URL fix REDs `importFidelity.test.ts`, whose
    fixture now carries Stripe's real trailing slash. Suite **301 → 312 passing**.
  - **Adoption:** VS Code 0.2.51. **Desktop has NOT** — it shares this import path, so it has all three
    bugs; see `../api2test/docs/TASKS.md`.

- [x] **RESP-SCHEMA — import threw away every response shape, so no GET's fields could be described**
  (2026-08-10, branch `develop`, uncommitted). Found the same day, when DD-STRUCT shipped and the
  user's actual field still showed nothing: *"previously there was a bug where the api data was not
  completely saved."* They were right.
  - **The gap:** `resolveBodySchema` → `resolveSchemaTree` was called for the **request** body only.
    For a response the adapter stored `generateExampleFromSchema`'s output — a flattened skeleton
    whose `getExampleValue` returns `[]` for every array and `''` for every string. So Stripe's
    `GET /v1/customers`, whose 200 is `{ data: [Customer], has_more, url }`, was written to disk as
    `{"data": [], "has_more": false, "object": "", "url": ""}`. A GET has no request body, and
    `extractFieldsFromSchema` falls back to `responseExamples` for those endpoints — so for **every
    GET** the field rows existed while nothing on disk said what they held. Verified against the
    user's real store: 441 of 589 imported endpoints had an empty `properties: {}` body schema.
  - **Why it survived so long:** the request-side half of the same defect WAS fixed (`74b00d4`,
    2026-07-15, "array-root request bodies extract the element's fields") and the response half was
    never filed. Nothing downstream read element shape until DD-STRUCT, so the loss had no symptom —
    `"data": []` yields the right name and the right type — and `grep responseExample test/` returned
    nothing: the path had no test at all.
  - **Fix:** new `UnifiedApiDto.responseBodySchema` + `ApiMethodDto.responseBodySchema`, filled by the
    OpenAPI/Swagger adapter with `resolveSchemaTree(spec, respJson?.schema || resp?.schema)` — the same
    resolver the request body already used, so `$ref`s inline and cycles are guarded. The flattened
    example is unchanged and still stored; it was never the right source for this.
  - **Bug-first:** new `test/responseSchemaImport.test.ts` drives the real sequence (detect →
    adaptToUnified → toApiMethodDto → store) then reads it back through `describeFieldStructure`.
    **2 failing / 1 passing** before, **3 passing** after; suite **298 → 301**. The third test pins the
    example's lossy behaviour deliberately, so a future "fix" to the example can't quietly replace it.
  - **Existing data is NOT migrated** — rows imported before this have no response schema and re-import
    is the only way to fill them. Clients must render no structure rather than invent one.
  - **Adoption:** VS Code the same day (Edit Field falls back to the response schema — DD-STRUCT-2 in
    `../Api2TestVS/docs/TASKS.md`). **Desktop has NOT** — see `../api2test/docs/TASKS.md`.

- [x] **DD-STRUCT — a dictionary field's own shape was unreadable, so `data: array` told the user
  nothing. DONE 2026-08-10 (`develop`, uncommitted).** Raised from VS Code (user, editing a Data
  Dictionary field: *"if the type is obj or array the edit needs more details"* → *"I want to see the
  structure of the array"*).
  - **The gap:** `extractFieldsFromSchema` deliberately makes ONE row for an `object`/`array` field —
    the row mirrors the body's top level. That is right, but it means nothing downstream can say what
    is inside: a client asking the user to pick a data method for `data: array` had no way to show
    that an element is `{ id, object, amount, currency, created }`. The shape was never lost, only
    unread — it is in the endpoint's own `requestBodySchema`.
  - **New `describeFieldStructure(requestBodySchema, fieldName)`** (`src/services/fieldStructure.ts`,
    exported) → `{ kind, elementType?, members[] }`, one level deep: array-of-objects reports its
    element's members in spec order, array-of-scalars reports the element type, an object reports its
    immediate members (a nested object is named, not expanded). Dotted names are walked, array
    wrappers are stepped through the same way extraction does, and anything unreadable (no schema,
    bad JSON, unknown field) is `undefined` rather than a throw — so a client just omits the display.
  - **Description only:** creates no rows, changes no types, feeds no generation.
  - **Bug-first:** new `test/fieldStructure.test.ts` — **6 failing** against a stub (today's state:
    nothing can read the shape), **7 passing** implemented. Suite **291 → 298**.
  - **Adoption:** VS Code consumed it the same day (the Edit Field dialog's Structure block — DD-EDIT
    in `../Api2TestVS/docs/TASKS.md`). **Desktop has NOT** — its Data Dictionary UI is its own and
    shows no structure; see `../api2test/docs/HANDOVER.md`.

- [x] **IMPORT-DEAD — two uncalled import methods were still carrying the quadratic write loop
  IMPORT-HANG had just removed. DONE 2026-08-10 (`develop`, uncommitted).** Found while collapsing VS
  Code's duplicate import (APP-ID-SINGLE); removed on the user's instruction the same day (*"remove the
  core dead code"*).
  **What was wrong:** `ApiLibraryService.importFromPostman` and `importFromOpenApi` had no caller in
  any repo — core, VS Code, Desktop, or the Jira app — and each still appended endpoints one at a time
  via `addItem`, which rewrites the whole collection per call. A fixed bug kept alive under a public
  method name that autocomplete offers: the next person to import a Postman collection "properly"
  would have bought the five-minute Stripe import straight back.
  **Fix:** both methods deleted, with the `postmanParser`/`openApiParser` fields they were the only
  users of. That left `PostmanParserService`/`OpenApiParserService` entirely uncalled — superseded by
  `ApiFormatAdapter`, which handles both formats along with RAML/GraphQL/Insomnia — so both files and
  their `index.ts` exports are deleted too. Verified unreferenced across all four repos first (classes
  *and* their exported interfaces).
  **Bug-first:** deleting code can't be proved by a suite that already passed, so the assertion is on
  the shape of the surface — `importWriteCost.test.ts` now reads the prototype and requires exactly
  `['importFromAny', 'importSingleEndpoint']`. RED with the dead pair present, GREEN after. It also
  guards the real failure mode: a *third* import path added later with its own loop and no cost test,
  which is how the first one survived. **313 → 314 passing.**
  **Editions:** rebuild `dist`. Not breaking for either client — neither imported the removed names.

- [x] **APP-ID-SINGLE — `importSingleEndpoint` was the one import path APP-ID-IMPORT missed, so a URL
  import was still name-only. DONE 2026-08-10 (`develop`, uncommitted).** Found in VS Code, which had
  kept its own copy of the method purely to add the id — a workaround the user rejected outright:
  *"if there is an issue with the core, it should be fixed, no workaround"*.
  **Root cause:** APP-ID-IMPORT threaded `applicationId` through `importFromAny` and `toApiMethodDto`
  and stopped there; `importSingleEndpoint` builds its DTO by hand, so it silently kept omitting the
  field. The library has two entry points and only one of them was fixed.
  **Fix:** `importSingleEndpoint(url, application, applicationId?)` stamps the id, same optional-param
  contract as `importFromAny`, so existing callers still compile.
  **Bug-first:** third case in [test/appIdImport.test.ts](../test/appIdImport.test.ts) drives the real
  URL import and then renames the application — RED (`applicationId` undefined), GREEN after.
  **312 → 313 passing.**
  **Editions:** rebuild core `dist`. **VS Code — adopted 2026-08-10**: its local copy of the method is
  deleted and it delegates (DD-STRUCT-4). **Desktop — nothing to adopt:** it has no caller of
  `importSingleEndpoint`.

- [x] **APP-ID-IMPORT — import stored the application NAME only, so a rename orphaned every imported
  endpoint and every class made from it. DONE 2026-08-10 (`develop`, uncommitted).** Raised from VS Code
  2026-07-29, fixed alongside the VS Code half on 2026-08-10 (user: *"we need to remove this
  inconsistency"*). **Root cause, in sequence:** the app is created with an id → import took the app as a
  **name string** (`toApiMethodDto(unified, source, application)` had no id parameter) → endpoints were
  stored name-only → `addClass` had no id to copy, so the class was name-linked too → deploy/namespace
  resolution fell back to the name. The id existed at step 1 and was dropped at step 2.
  **Fix:** `ApiMethodDto.applicationId` and `ApiClassLibraryDto.applicationId` added (documented as the
  authoritative, rename-proof link); `toApiMethodDto` and `ApiLibraryService.importFromAny` take an
  optional `applicationId` and stamp it on every endpoint; `ApiClassLibraryService.addClass` copies
  `apiMethod.applicationId` onto the class entry — so `DictionaryImportService.importApis`, which makes
  every class through it, is covered too. Optional param = existing callers still compile.
  **Bug-first:** new [test/appIdImport.test.ts](../test/appIdImport.test.ts) drives the real import →
  importApi sequence, then renames the application: RED on both tests (`applicationId` undefined; the
  class unresolvable), GREEN after. **291 passing** (was 289 + the 2 new).
  **Editions:** rebuild core `dist`. **VS Code — adopted 2026-08-10** (picker now returns the app record,
  `importFromAny`/`importSingleEndpoint` pass the id, `addClass` prefers the endpoint's id over its
  name lookup; 180 passing). **Desktop — NOT adopted:** its import route
  (`ui-browser/api2test.client/src/app/api/apilibrary/upload-api/route.ts`) builds the DTO rows itself
  from `adaptToUnified` and sets `application` only, so it must pass the picked app's id through —
  noted in `../api2test/docs/HANDOVER.md`.

- [x] **CAP-INVAR — a value captured the typed way (`captures[]`) was invisible to a later step's IN
  param; the second class could not bind it. DONE 2026-08-05 (`develop`).** Found reviewing the Desktop
  Create Test Case flow (user: *"the IN parameter, in the second class is not working"*). The E2E-CAP-1
  refactor moved OUT captures from separate extract steps into `captures[]` on the Class step, and
  updated the producers (generation reads `item.captures`) and the dialog's OUT rows — but
  `availableVarsBefore` (`e2eCaseLogic.ts`), the function that lists variables offered to a later step's
  IN dropdown, still read only `assignTo` + the legacy singular `capture`. So a `captures[]` variable
  never reached the second class's "select variable…" list. **Why tests missed it:** the one
  `availableVarsBefore` test used only the legacy `capture` shape; it's a characterization suite (froze
  pre-refactor behaviour) and passed *unchanged* through E2E-CAP-1 — the red flag CLAUDE.md names — and
  nothing tested the producer→consumer seam. Fix: collect `s.captures[].variable` too. Bug-first: new
  test `availableVarsBefore lists typed captures[]` RED before / GREEN after; whole suite 276 pass.
  **Editions:** rebuild core `dist`; Desktop + VS Code consume on next core bump/reload.

- [x] **RUN-TRX — every local C# run reported "dotnet test produced no TRX", even when the tests passed.
  DONE 2026-08-03 (`develop`).** Raised from VS Code 2026-08-03: the user ran Execute twice and got
  `Failed to execute test: dotnet test produced no TRX.` both times — once on a run whose output said
  `Failed! - Failed: 1, Passed: 0` and once on `Passed! - Failed: 0, Passed: 1`. The pass proved the
  runner, not the test, was broken.
  - **Cause:** the scaffolded sandbox is `<Project Sdk="MSTest.Sdk/3.6.4">`, which runs on
    **Microsoft.Testing.Platform**, not VSTest. `runDotnetTest` passed VSTest's
    `--logger trx;LogFileName=results.trx`; MTP has no such logger, ignored it, and wrote no TRX. The
    runner then read the missing file as "the build failed before any test ran" and reported that instead
    — hiding a green run entirely, and hiding the real assertion message of a red one.
  - **Fix:** [TestRunnerService.ts](../src/services/TestRunnerService.ts) —
    `usesTestingPlatform(projectPath)` reads the project file (`Sdk="MSTest.Sdk…"`, with
    `<EnableMSTestRunner>` winning where it is explicit; unreadable ⇒ VSTest, the old behaviour), and
    `dotnetTestArgs(...)` builds the command line for whichever platform it is: MTP gets
    `-- --report-trx --report-trx-filename results.trx --results-directory <dir>` (options after `--` go
    to the test app, which is where MTP reads them), VSTest keeps exactly the arguments it always had.
    `--filter` goes on the matching side of the `--`, so running a single case still runs a single case.
  - **Bug-first test:** [test/dotnetRunnerArgs.test.ts](../test/dotnetRunnerArgs.test.ts) — 6 tests,
    **all 6 fail** against the single-shape `args` (the functions don't exist), all pass after. Suite
    269 → **275 passing**. Verified end-to-end against the user's real sandbox: the MTP command writes
    `results.trx`, `parseTrx` reads it back as `TestPet / Passed / 433ms` with the captured API call, and
    a bogus `--filter` matches 0 tests (so the filter is honoured, not ignored).
  - **Edition impact:** both editions share this runner, so **both** were affected — Desktop's local
    runner is broken in exactly the same way against any MSTest.Sdk project and is fixed by taking this
    bump. The csproj template itself lives in each client (VS Code:
    `src/services/sandboxScaffold.ts`), so the fix had to work on sandboxes that already exist — it does,
    nothing is regenerated.

- [x] **CAP-TYPE — the store-as picker offers the chosen language's own types. DONE 2026-08-03
  (`develop`).** User, after testing the TYPE-1 fix: *"I select the addpet class, the out parameter
  id(decimal) but I can only assign number, the issue is the next class is placeOrder the petId(int)"* —
  then *"as we are working in C# I would like to see all the C# type options in the dropdown"*.
  - **Was:** one abstract list, `string / number / bool / Guid`, mapped to the language on the way out.
    A C# workspace chaining an id into an `int?` field had no `int` to pick, only `number` (→ `decimal`).
    The generated code was already right (TYPE-1 takes the destination field's type), but the UI said
    otherwise — and where nothing constrains the capture, the pick is all there is.
  - **Fix:** `captureTypes(language)` in [fieldTypes.ts](../src/services/fieldTypes.ts), next to
    `fieldDisplayType` — C# `string/int/long/decimal/double/bool/Guid/DateTime`, TS
    `string/number/boolean`, Python `str/int/float/bool`. Concrete types, so `mapCaptureType` passes them
    through untouched: what is picked is what is declared. The old abstract values still map as they did,
    so saved cases regenerate unchanged.
  - **Bug-first test:** [test/fieldTypes.test.ts](../test/fieldTypes.test.ts) — the two new CAP-TYPE tests
    fail (`captureTypes is not a function`, 5/7) before the function exists and pass after; one asserts
    every offered type survives `mapCaptureType` as itself, one that a case holding the old `number`
    still maps to `decimal`. Suite 266 → **269 passing**.
  - **Edition impact:** VS Code consumed it the same day (**CAP-TYPE**, commit on `sp1-1-deploy-via-core`)
    and **deleted** its local `CAPTURE_TYPES` and `storeAsFor`. Desktop still has its own copy — it picks
    this up with **CAP-CORE**, and until it does its picker stays abstract.

- [x] **OVR-CASE — a pinned field addressed the raw field name, not the generated property, so the test
  did not compile. DONE 2026-08-02 (`develop`).** Found 2026-08-01 reviewing a three-class PetStore chain
  from the VS Code builder (add pet → create order → delete order).
  - **Was emitted:** `new PetStoreCreateOrder() { petId = petId, status = "placed" }` against a class
    declaring `public decimal PetId` / `public string Status`. C# is case-sensitive, so any pinned field
    whose spec name was not already PascalCase (`petId`, `pet_id`, `shipDate`, …) was a compile error.
    Second symptom, same cause: `csTypeOf` looked the property up case-sensitively, missed, and fell back
    to `string` — so a numeric literal came out quoted (`PetId = "5"`).
  - **Root cause:** `classInitializer` used the override KEY verbatim. Clients key overrides by the spec
    field name, which is **correct at rest** (it is what the spec says, and it survives a change of target
    language) — the mapping to the property name belongs at emit.
  - **Fix (C#):** `formatPropertyName` moved out of `ClassGenerationService` into
    `services/classNaming.ts` as exported **`csPropertyName`**; the service now delegates to it, and
    `classInitializer` maps every override key through it — for the assigned name, for the `csTypeOf`
    lookup, and for the "Fields pinned for this test" note. Shared, not copied, so the two can't drift.
  - **Fix (TS half, found while scoping this):** the TS emitter has the **opposite** rule — the property
    name IS the raw JSON key, quoted when it isn't a valid JS identifier — and the same bypass:
    `classConstruct` didn't quote, so a header-style field (`pet-id`, `Content-Type`) emitted
    `{ pet-id: … }` against a class declaring `'pet-id'` — a syntax error. `propKey` moved into
    `tsNaming.ts` as exported **`tsPropKey`**, used by both the request-class emitter and the
    initializer. `tsTypeOf`'s regex is now escaped too (a `pet.id` field matched loosely).
  - **Python: not affected** — `python` is in `TargetLanguage` but there is no Python emitter (only seed
    data libraries); PY-1 is still parked. Nothing to change.
  - **Bug-first:** `test/overrides.test.ts` was the test that should have caught it and didn't — it keyed
    its overrides `Email`/`Age`, already PascalCase, so it never exercised the mapping. Re-keyed to the
    real client shape (`email`/`age`) + a new snake_case case (`pet_id` → `PetId = 5` unquoted); new
    non-identifier case in `test/e2eTypeScript.test.ts` (strict-`tsc`-compiled, as that suite does).
    **4 cases RED on the old code → all green.** Build clean, **260/260** (was 258).
  - **Edition impact: BOTH** — same generator, same override shape. Coordinated version bump on adoption.
  - **Paired re-review** in [`../Api2TestVS/docs/TASKS.md`](../../Api2TestVS/docs/TASKS.md) as **RB-21**:
    un-skip the pending assertion in `src/test/suite/e2eThreeStepChain.test.ts` and re-run the chain.
  - **Follow-up NOT done here (deliberate, agreed 2026-08-02):** a UI-side validator for override
    *values* — an orphaned pin (field gone after re-import) and a value that can't parse as the field's
    type. Those are authoring-time problems emit can't see; the casing is not one, and must not be
    re-implemented per client. Filed edition-side, not here.

- [x] **CI actions → node24 runtimes** (2026-07-13): checkout/setup-node v5 (`391d673`), then Dependabot
  majors merged — codeql-action 4 (PR #1), checkout 7 (PR #2), setup-node 6 (PR #3). CI green.
