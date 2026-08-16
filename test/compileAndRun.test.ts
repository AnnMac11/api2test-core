/**
 * RUN-LANG — one language-routed compile-and-run entry point, shared by every edition.
 *
 * Both VS Code call sites (Execute, Test Sets) and the enterprise app (TS-C4) need "compile the
 * project, then run its tests" routed by the install language. Before this existed each caller
 * branched on the language itself — Test Sets never did, so a python install ran `dotnet test`
 * on a folder holding requirements.txt. The routing lives here so it exists exactly once.
 *
 * Also RUN-FW: the frameworks a language can target (the first is the default) — the E2E dialog
 * used to offer MSTest/xUnit/NUnit regardless of language.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compileAndRunTests } from '../src/services/TestRunnerService';
import { frameworksFor } from '../src/models/E2EDto';
import { tmpDir } from './tmp';

function hasPython(): boolean {
  try { execFileSync('python', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

test('frameworksFor: each language offers its own frameworks, default first', () => {
  assert.deepEqual(frameworksFor('csharp'), ['MSTest', 'xUnit', 'NUnit']);
  assert.deepEqual(frameworksFor('typescript'), ['Vitest']);
  assert.deepEqual(frameworksFor('python'), ['pytest']);
});

test('compileAndRunTests routes python to the python toolchain, not dotnet', { skip: !hasPython() }, async () => {
  // A python unit with a syntax error: the python path reports the SyntaxError from `compileall`
  // and runs nothing; the pre-routing behaviour (dotnet on this folder) could never produce it.
  const dir = tmpDir('a2t-runlang-');
  try {
    fs.writeFileSync(path.join(dir, 'test_broken.py'), 'def test_x(:\n    pass\n');
    const { build, results } = await compileAndRunTests('python', dir);
    assert.equal(build.ok, false);
    assert.ok(build.errors.some(e => /SyntaxError|Error compiling|\*\*\*/.test(e)),
      `expected a python compile error, got: ${build.errors.join(' | ')}`);
    assert.deepEqual(results, []); // build failed → nothing ran
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
