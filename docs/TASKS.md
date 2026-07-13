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

## Done (kept for re-verification — do not delete)

_Move items here when complete; note the branch/PR + which editions consumed the bump._

- [x] **CI actions → node24 runtimes** (2026-07-13): checkout/setup-node v5 (`391d673`), then Dependabot
  majors merged — codeql-action 4 (PR #1), checkout 7 (PR #2), setup-node 6 (PR #3). CI green.
