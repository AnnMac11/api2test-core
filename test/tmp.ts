/**
 * TMP-CLEAN — temp directories that delete themselves when the test process exits.
 *
 * Every suite that touches the filesystem used to `mkdtempSync` straight into the OS temp root and
 * leave the directory behind. Across months of runs (both repos, plus CI) that accumulated 17,532
 * orphaned `a2t-*` directories, ~430 MB, in the user's `%TEMP%`. The cost is not only disk: pytest
 * infers its rootdir by walking UP from the directory it is handed, so a temp root with thousands of
 * siblings turns every Python run into a scan of all of them (see PYT-ROOT in TestRunnerService).
 *
 * A per-test `finally` is not enough — a test that throws skips it, and those are exactly the runs
 * that leave the most behind. Registering on `process.on('exit')` catches every path out, and
 * `rmSync` is synchronous so it still completes inside an exit handler.
 *
 * Not run as a suite: the runner globs `test/*.test.ts`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const created: string[] = [];
let hooked = false;

/** `mkdtempSync` under the OS temp root, registered for removal when this process exits. */
export function tmpDir(prefix: string): string {
  if (!hooked) {
    process.on('exit', cleanupTmpDirs);
    hooked = true;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Remove every directory `tmpDir` handed out. Best-effort: a locked file must not fail the run. */
export function cleanupTmpDirs(): void {
  for (const dir of created.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
