# API2Test core (shared engine) — running task list

> **This file is the durable source of truth for open core tasks.** The in-session task tracker and
> background "chips" do NOT survive a new thread — this file does. Read it at the start of a session,
> append the moment a task is agreed, tick items off (don't delete) as they're done, and update it
> before ending a session. See `CLAUDE.md` → "Task tracking". _Created 2026-07-13._

Core is consumed by both the Desktop app ([`../api2test/docs/TASKS.md`](../../api2test/docs/TASKS.md))
and the VS Code extension ([`../Api2TestVS/docs/TASKS.md`](../../Api2TestVS/docs/TASKS.md)). Changes
here affect both editions — note the coordinated version bump on any task that ships.

## Open

- [ ] _(none yet — add tasks here as we agree them)_

## Done (kept for re-verification — do not delete)

_Move items here when complete; note the branch/PR + which editions consumed the bump._
