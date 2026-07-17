import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DeployDestinationDto } from './DeployDestinationService';
import { deployUnit, DeployCase, DeployUnitOptions, DeployUnitResult } from './deployUnit';

/**
 * Deploy a test set to a named destination (REG-2) — the "out" half of the regression loop,
 * lifted from Desktop `gitDeploy.ts` and re-targeted at REG-1 destinations. The app owns a local
 * **clone** of the destination repo (under `cloneBaseDir`, keyed by destination id so renames
 * don't orphan it); Deploy writes the compilable unit via {@link deployUnit} under the
 * destination's stored `path`, then commits and **pushes** so the pipeline runs it on push.
 *
 * Authoring/runs stay local (0a, 2026-07-17) — this is the only step that leaves the machine.
 * Auth is the **machine's own git credentials** (credential manager / ssh-agent) — no stored
 * secrets. A destination repo accumulates (never cleaned): it is a curated, promoted project.
 */
export interface DeployTestSetOptions extends Pick<DeployUnitOptions, 'emitter' | 'resolveClass' | 'apiMethods' | 'dataMethods'> {
  /** Where the app keeps its managed clones (client data dir). One subfolder per destination id. */
  cloneBaseDir: string;
}

export interface DeployTestSetResult {
  pushed: boolean;
  message: string;
  /** Test cases actually deployed (had generated code). */
  deployed: number;
  /** Ids of cases skipped because they have no generated code. */
  notGenerated: string[];
  /** The pushed commit hash, when a push happened. */
  commit?: string;
  /** Files written into the clone (absolute paths). */
  files: string[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Ensure `dir` is a clone of `url` on `branch`: clone if absent (tolerating an empty remote),
 *  else fetch + check the branch out. Best-effort on fetch so an offline deploy still writes. */
function ensureClone(dir: string, url: string, branch: string): void {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try {
      execFileSync('git', ['clone', '--branch', branch, url, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // Empty remote (no branches yet), or the branch doesn't exist yet: clone what's there, then
      // create the branch locally (it materialises on the first push).
      execFileSync('git', ['clone', url, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      try { git(dir, ['checkout', '-B', branch]); } catch { /* branch is created on the first commit */ }
    }
  } else {
    try { git(dir, ['fetch', 'origin']); } catch { /* offline — push later will report */ }
    try { git(dir, ['checkout', branch]); } catch { git(dir, ['checkout', '-B', branch]); }
  }
}

/** The deploy root inside the clone: the destination's stored `path`, confined to the clone. */
function rootWithin(cloneDir: string, destPath: string): string {
  const root = path.resolve(cloneDir, destPath || '.');
  const clone = path.resolve(cloneDir);
  if (root !== clone && !root.startsWith(clone + path.sep)) {
    throw new Error(`Destination path "${destPath}" escapes the repository.`);
  }
  return root;
}

/** Deploy `cases` to `destination`: ensure-clone → deployUnit under the stored path → commit → push. */
export async function deployTestSet(
  cases: DeployCase[],
  destination: DeployDestinationDto,
  opts: DeployTestSetOptions,
): Promise<DeployTestSetResult> {
  const branch = destination.branch || 'main';
  const cloneDir = path.join(opts.cloneBaseDir, destination.id);
  const root = rootWithin(cloneDir, destination.path);

  ensureClone(cloneDir, destination.repoUrl, branch);

  // Destination repos accumulate — never clean (that is sandbox semantics only).
  const unit: DeployUnitResult = deployUnit(cases, {
    root,
    emitter: opts.emitter,
    resolveClass: opts.resolveClass,
    apiMethods: opts.apiMethods,
    dataMethods: opts.dataMethods,
  });
  const deployed = cases.length - unit.notGenerated.length;

  git(cloneDir, ['add', '-A']);
  if (!git(cloneDir, ['status', '--porcelain'])) {
    return {
      pushed: false,
      message: `Nothing to deploy — "${destination.name}" is already up to date (${deployed} test${deployed === 1 ? '' : 's'}).`,
      deployed, notGenerated: unit.notGenerated, files: unit.files,
    };
  }
  // Commit with an explicit identity so it works without a configured global git user (CI/first run).
  git(cloneDir, ['-c', 'user.email=ci@api2test.local', '-c', 'user.name=API2Test', 'commit', '-m',
    `Deploy ${deployed} test${deployed === 1 ? '' : 's'} to ${destination.name}`]);
  const commit = git(cloneDir, ['rev-parse', 'HEAD']);
  git(cloneDir, ['push', '-u', 'origin', branch]);
  return {
    pushed: true,
    message: `Deployed ${deployed} test${deployed === 1 ? '' : 's'} to ${destination.name} (${destination.repoUrl}, ${branch}).`,
    deployed, notGenerated: unit.notGenerated, commit, files: unit.files,
  };
}
