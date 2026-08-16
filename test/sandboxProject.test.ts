import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSandbox, SANDBOX_SCAFFOLDERS } from '../src/services/sandboxProject';
import type { DotnetInfo, ProbeRunner } from '../src/services/toolchainDetection';
import { tmpDir } from './tmp';

const DOTNET_8: DotnetInfo = { hasSdk: true, sdks: ['8.0.404'], runtimeMajors: [8], tfm: 'net8.0' };
const NO_DOTNET: DotnetInfo = { hasSdk: false, sdks: [], runtimeMajors: [], tfm: undefined };

const NODE_OK: ProbeRunner = (cmd) => (cmd === 'node' ? 'v22.14.0' : cmd === 'npm' ? '10.9.2' : null);
const NO_NODE: ProbeRunner = () => null;

// ── Language symmetry: a real scaffolder per shipped language ─────────────────────────────────

test('a scaffolder exists for every shipped language — csharp, typescript AND python', () => {
  assert.equal(typeof SANDBOX_SCAFFOLDERS.csharp, 'function');
  assert.equal(typeof SANDBOX_SCAFFOLDERS.typescript, 'function');
  assert.equal(typeof SANDBOX_SCAFFOLDERS.python, 'function');
});

// ── C# sandbox (lifted from Desktop sandboxProject.ts) ────────────────────────────────────────

test('csharp: scaffolds sandbox.csproj targeting the detected tfm with pinned test packages', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('csharp', dir, { dotnet: DOTNET_8 });
  assert.equal(res.ok, true);
  assert.equal(res.tfm, 'net8.0');
  assert.ok(res.projectPath!.endsWith('sandbox.csproj'));
  const csproj = fs.readFileSync(res.projectPath!, 'utf8');
  assert.match(csproj, /<TargetFramework>net8\.0<\/TargetFramework>/);
  for (const pkg of ['Microsoft.NET.Test.Sdk', 'MSTest.TestAdapter', 'MSTest.TestFramework', 'Bogus']) {
    assert.match(csproj, new RegExp(pkg.replace(/\./g, '\\.')), `${pkg} reference missing`);
  }
});

test('csharp: no .NET SDK -> ok:false with an actionable reason, and NOTHING written', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('csharp', dir, { dotnet: NO_DOTNET });
  assert.equal(res.ok, false);
  assert.match(res.reason || '', /\.NET SDK/);
  assert.deepEqual(fs.readdirSync(dir), [], 'must not scaffold without an SDK');
});

test('csharp: idempotent — unchanged tfm leaves the file alone, changed tfm rewrites it', () => {
  const dir = tmpDir('a2t-sandbox-');
  const first = ensureSandbox('csharp', dir, { dotnet: DOTNET_8 });
  const stat1 = fs.statSync(first.projectPath!);
  const res2 = ensureSandbox('csharp', dir, { dotnet: DOTNET_8 });
  assert.equal(fs.statSync(res2.projectPath!).mtimeMs, stat1.mtimeMs, 'same tfm must not rewrite (needless restore)');

  const res3 = ensureSandbox('csharp', dir, { dotnet: { ...DOTNET_8, runtimeMajors: [10], tfm: 'net10.0' } });
  assert.match(fs.readFileSync(res3.projectPath!, 'utf8'), /<TargetFramework>net10\.0<\/TargetFramework>/);
});

test('csharp: a corrupted csproj is restored on the next ensure', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('csharp', dir, { dotnet: DOTNET_8 });
  fs.writeFileSync(res.projectPath!, '<Project>corrupt</Project>');
  ensureSandbox('csharp', dir, { dotnet: DOTNET_8 });
  assert.match(fs.readFileSync(res.projectPath!, 'utf8'), /MSTest\.TestFramework/);
});

// ── TS sandbox (the NF-2 vitest scaffold, created here) ───────────────────────────────────────

test('typescript: scaffolds package.json (typescript+vitest+faker devDeps) + strict tsconfig', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('typescript', dir, { run: NODE_OK });
  assert.equal(res.ok, true);
  assert.equal(res.projectPath, dir, 'TS projectPath is the project dir (what runVitest/runTsc take)');

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  for (const dep of ['typescript', 'vitest', '@faker-js/faker']) {
    assert.ok(pkg.devDependencies?.[dep], `${dep} missing from devDependencies`);
  }

  // The compile contract: the sandbox MUST type-check under the same settings the TS emit layer is
  // proven against (test/*TypeScript tests compile emitted code with exactly these).
  const tsconfig = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
  assert.equal(tsconfig.compilerOptions.strict, true, 'sandbox must compile emitted code under strict');
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.equal(tsconfig.compilerOptions.moduleResolution, 'bundler');
});

test('typescript: missing node/npm -> ok:false naming the missing tool, and NOTHING written', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('typescript', dir, { run: NO_NODE });
  assert.equal(res.ok, false);
  assert.match(res.reason || '', /Node\.js/);
  assert.deepEqual(fs.readdirSync(dir), [], 'must not scaffold without a toolchain');
});

// ── Python sandbox (the SP-PY pytest scaffold) ────────────────────────────────────────────────

// Probe runner: python present; deps import probe answers 'ok' only when `deps` is true.
const pyRunner = (deps: boolean): ProbeRunner => (cmd, args) => {
  if (cmd !== 'python') return null;
  if (args[0] === '--version') return 'Python 3.13.5';
  if (args[0] === '-c') return deps ? 'ok' : null;
  return null;
};
const NO_PYTHON: ProbeRunner = () => null;

test('python: scaffolds requirements.txt declaring pytest + requests + faker', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('python', dir, { run: pyRunner(false) });
  assert.equal(res.ok, true);
  assert.equal(res.projectPath, dir, 'Py projectPath is the project dir (what runPyCompile/runPytest take)');
  const reqs = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
  for (const dep of ['pytest', 'requests', 'faker']) {
    assert.match(reqs, new RegExp(`^${dep}`, 'm'), `${dep} missing from requirements.txt`);
  }
});

test('python: missing interpreter -> ok:false naming Python, and NOTHING written', () => {
  const dir = tmpDir('a2t-sandbox-');
  const res = ensureSandbox('python', dir, { run: NO_PYTHON });
  assert.equal(res.ok, false);
  assert.match(res.reason || '', /Python/);
  assert.deepEqual(fs.readdirSync(dir), [], 'must not scaffold without an interpreter');
});

test('python: depsReady reflects whether the declared packages import (install stays an explicit client step)', () => {
  const dir = tmpDir('a2t-sandbox-');
  const before = ensureSandbox('python', dir, { run: pyRunner(false) });
  assert.equal(before.depsReady, false, 'pytest/requests/faker not importable yet');
  const after = ensureSandbox('python', dir, { run: pyRunner(true) });
  assert.equal(after.depsReady, true);
});

test('python: idempotent — an unchanged requirements.txt is not rewritten', () => {
  const dir = tmpDir('a2t-sandbox-');
  ensureSandbox('python', dir, { run: pyRunner(false) });
  const stat1 = fs.statSync(path.join(dir, 'requirements.txt'));
  ensureSandbox('python', dir, { run: pyRunner(false) });
  assert.equal(fs.statSync(path.join(dir, 'requirements.txt')).mtimeMs, stat1.mtimeMs, 'must not rewrite unchanged (watcher churn)');
});

test('typescript: depsReady reflects node_modules state (install stays an explicit client step)', () => {
  const dir = tmpDir('a2t-sandbox-');
  const before = ensureSandbox('typescript', dir, { run: NODE_OK });
  assert.equal(before.depsReady, false, 'no node_modules yet');

  for (const dep of ['vitest', '@faker-js/faker', 'typescript']) {
    fs.mkdirSync(path.join(dir, 'node_modules', dep), { recursive: true });
  }
  const after = ensureSandbox('typescript', dir, { run: NODE_OK });
  assert.equal(after.depsReady, true);
});
