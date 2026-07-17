# CLAUDE.md — API2Test core (shared engine)

Project guidance loaded at the start of every session.

`api2test-core` is the shared engine (spec parsing, generation, TRX runner, licensing) consumed by both
the Desktop app (**`../api2test`**) and the VS Code extension (**`../Api2TestVS`**). Changes here affect
both editions — coordinate version bumps.

> **Start here:** for the full project orientation read [`../api2test/docs/HANDOVER.md`](../api2test/docs/HANDOVER.md)
> (the Desktop repo holds the canonical onboarding). Then this repo's `docs/TASKS.md` for core tasks.

## Testing

This repo is **layer 1 (engine unit)** of the regression stack defined in
[`../api2test/tests/README.md`](../api2test/tests/README.md) — read its "How deep — assertion rules"
section before writing tests here. Engine tests live in `test/` and must **pin the concrete generated
output** (e.g. the generated property is `public int Id`, not just "a class was produced") — #52
(integer→`decimal`) survived a green suite precisely because no assertion did this.

## Task tracking

- The single source of truth for open tasks is **`docs/TASKS.md`** (this repo, shared core),
  **`../api2test/docs/TASKS.md`** (the Desktop app), and **`../Api2TestVS/docs/TASKS.md`** (the VS Code
  extension). NOT the in-session task tracker, NOT background chips — those do not survive a new thread.
- **Start of session:** read the relevant `TASKS.md` before proposing work.
- **When a task is agreed:** append it to `TASKS.md` immediately — id/short description, status, and the
  repo + branch if it has one. Do not rely on the live tracker to remember it.
- **When a task is done:** move it to the Done section (don't delete — we re-verify), and note the
  branch/PR. "Done" means the **bug-first test protocol** was followed (see
  `../api2test/docs/HANDOVER.md`): identify the test that should have caught it → alter it to FAIL on
  the broken code → fix → same test passes, both runs shown. An old test passing unchanged after a fix
  is a red flag.
- **End of session:** update `TASKS.md` so the next thread starts current.
