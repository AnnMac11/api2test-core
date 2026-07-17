# api2test-core — Developer Manual

> Architecture, module map, and maintenance guidance for the **shared engine**. Core is a library —
> it has no UI and no HTTP surface; the editions (Desktop `../api2test`, VS Code `../Api2TestVS`)
> put screens on top. **A change here ships to both** — coordinate version bumps. _Created
> 2026-07-17._

## 1. What core is

Everything both editions need to turn an API spec into executable tests: spec parsing/detection,
the Data Dictionary + curated libraries, code generation (C# + TypeScript), orchestration of the
import/generate flows, the local test runners, and **licensing**. Consumed via a `file:` dependency
(repos side-by-side); publish to a registry only when independent CI builds need it.

Build/test: `npm run build` (tsc → `dist/`), `npm test` (node:test over `test/*.test.ts`).
Testing rules: this repo is **layer 1 (engine unit)** of the stack defined in
`../api2test/tests/README.md` — assertions pin the CONCRETE generated output, and every change
follows the bug-first protocol (see `HANDOVER.md`).

## 2. Module map (`src/`)

| Area | Where | What |
|---|---|---|
| Models | `models/` | DTOs shared by all editions |
| Adapters | `adapters/` | Install-time seams: `StorageProvider` (File/SQL/Mongo), `CodeEmitter` (C#/TS via `emitterFor(language, storage)`), `DeployTarget` |
| Parsing | `services/ApiFormat*`, `*ParserService` | OpenAPI / Postman detection + parsing |
| Dictionary + libraries | `services/DataDictionaryService`, `DataLibraryService`, `Api*LibraryService` | Fields, type-classes, method libraries |
| Orchestration | `services/DictionaryImportService`, `batchClassGeneration` | The lifted client flows (ORCH): import endpoint(s), batch class generation — clients call one method and render the tally |
| Generation | `services/*Generation*`, `generate*` | Per language + kind; folder/namespace truth in `generatedNamespaces.ts`; TS naming bridge `tsNaming.ts` |
| Seed libraries | `data/libraries/<lang>/`, `data/defaultLibraries.ts` | Curated Data + API Method libraries, language-keyed — single source of truth |
| Runners | `services/TestRunnerService` | `runDotnetBuild/Test` + TRX parse; `runVitest/runTsc` + per-test call attribution |
| Licensing | `licensing/` | See §3 — the whole-app gate |
| E2E logic | `services/e2eCaseLogic`, `E2ETestGenerationService` | Chain composition rules + generation |

The public surface is exactly what `src/index.ts` exports — everything else is internal.

## 3. Licensing (rewritten 2026-07-17 — LIC series)

**Model (authority: `../api2test/docs/HANDOVER.md` §4):** a licence is required for ALL
functionality — a whole-app gate on every product. **No per-feature gating, no free tier, no
plans.** 60-day trial → hard lock; a 30-day extension is just a longer-dated token. The commercial
end-game is deliberately open — nothing here may hardwire a SKU model.

### Token

`base64url(header).base64url(payload).base64url(signature)`, Ed25519 over `header.payload`.
Claims are **minimal**: `sub` (customer id), `exp` (Unix s), `iat?`, `iss?`. The verifier
**ignores unknown claims** — future backends may add claims without breaking shipped clients.
Lifetime = far-future `exp`; subscription = ~1-year `exp` reissued on renewal; same verify path.

### Modules

- **`licensing/entitlements.ts`** — offline verification. `verifyEntitlement(token, publicKeyPem?,
  now?)` → `Entitlement { valid, expiresAt, reason? }`; fails safe to `UNLICENSED` with a `reason`
  (`no token` / `malformed` / `bad signature` / `expired`). `LICENSE_PUBLIC_KEY` is the embedded
  verify key — **currently the DEV key**; the prod swap is a release step (Desktop TASKS Phase 7
  #10) and requires rebuilding BOTH editions.
- **`licensing/manager.ts`** — the one access point clients use. `createLicenseManager({
  tokenStore, trialStore, publicKeyPem?, trialDays? })` returns:
  - `getAccess(now?)` → `licensed | trial (daysLeft) | expired`. Valid token always wins; else the
    60-day trial (start stamped once, **soft by design** — a local stamp the user could delete;
    accepted for the beta audience); else expired.
  - `enterKey(token)` — verifies and stores **only if valid**; an invalid key never changes stored
    state. Returns `{ entitlement, access }` so the UI can show the rejection reason.
  - `removeKey()` — back to the trial clock (never "free").
  - `getToken()`.

  Clients implement two tiny **async** stores: `TokenStore { get/set/clear }` and `TrialStore
  { get/set }` — Desktop: files in `%APPDATA%\api2test`; VS Code: `SecretStorage` + `globalState`.
  Everything else (UI, notifications, status bar) is edition code.

### Key tooling (`scripts/license/`)

- `generate-keys.js [outDir]` — Ed25519 pair → `keys/` (gitignored) or `outDir`. Embed the PUBLIC
  key in `entitlements.ts`; the PRIVATE key lives only on the issuing backend.
- `sign.js --sub <id> --days <n> [--key <private.pem>]` — signs a token (minimal claims). Dev/beta
  issuing until the backend exists.

### Tests

`test/entitlements.test.ts` (verify paths incl. unknown-claims-ignored), `test/licenseManager.test.ts`
(trial stamp-once, countdown/expiry boundary, licence-wins, store-only-if-valid — guard proven
against a broken variant), `test/licenseScripts.test.ts` (drives the real scripts end-to-end and
pins the claims shape).

### What clients must NOT do

Re-implement any access rule (trial maths, expiry, validity) client-side; add claims casually;
gate individual features. If a client needs a new licence behavior, it goes here.

## 4. Conventions

- **Bug-first protocol** for every change (see `HANDOVER.md` §How we work) — show the guard red on
  broken code, green after; assertions pin concrete output.
- **Client-shared logic belongs here.** If Desktop and VS Code would each need a copy, it's a core
  module with a client-supplied adapter (storage/emitter/stores) — the ORCH and LIC series are the
  pattern to follow (next: DET/DEP/SBX/SEED/REG/APP — TASKS.md "Desktop→core lifts").
- **Comments** state constraints and the why (e.g. "soft by design", "ignores unknown claims"), not
  what the next line does.
