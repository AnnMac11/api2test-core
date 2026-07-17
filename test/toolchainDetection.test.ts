import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectToolchain, detectDotnet, pickTfm, parseSdkList, parseRuntimeMajors,
  TOOLCHAIN_PROBES,
} from '../src/services/toolchainDetection';
import type { TargetLanguage } from '../src/adapters/CodeEmitter';

// A fake runner: maps "cmd arg1 arg2" -> stdout (null = tool not on PATH). Lets the tests drive
// the REAL detection logic over pinned machine outputs, without depending on what this machine has.
function fakeRunner(outputs: Record<string, string | null>) {
  return (cmd: string, args: string[]) => outputs[[cmd, ...args].join(' ')] ?? null;
}

// Real `dotnet --list-sdks` / `--list-runtimes` output shapes (Windows paths, mixed runtimes).
const LIST_SDKS = [
  '6.0.428 [C:\\Program Files\\dotnet\\sdk]',
  '8.0.404 [C:\\Program Files\\dotnet\\sdk]',
  '10.0.301 [C:\\Program Files\\dotnet\\sdk]',
].join('\r\n');
const LIST_RUNTIMES = [
  'Microsoft.AspNetCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]',
  'Microsoft.NETCore.App 6.0.36 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]',
  'Microsoft.NETCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]',
  'Microsoft.NETCore.App 10.0.2 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]',
  'Microsoft.WindowsDesktop.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App]',
].join('\r\n');

// ── The language-symmetry guard (the point of DET-1): no C#-privileged paths ──────────────────

test('every TargetLanguage has real toolchain probes — csharp, typescript AND python', () => {
  const languages: TargetLanguage[] = ['csharp', 'typescript', 'python'];
  for (const language of languages) {
    const probes = TOOLCHAIN_PROBES[language];
    assert.ok(probes && probes.length > 0, `${language} has no toolchain probes`);
    const info = detectToolchain(language, fakeRunner({}));
    assert.equal(info.language, language);
    assert.equal(info.tools.length, probes.length, `${language} detector skipped probes`);
  }
});

test('detectToolchain marks present tools with their version and computes ready', () => {
  const info = detectToolchain('typescript', fakeRunner({
    'node --version': 'v22.14.0\n',
    'npm --version': '10.9.2\n',
  }));
  assert.deepEqual(info.tools.map(t => [t.name, t.present, t.version]), [
    ['Node.js', true, 'v22.14.0'],
    ['npm', true, '10.9.2'],
  ]);
  assert.equal(info.ready, true);
});

test('one missing tool -> that row absent + ready=false (others still reported)', () => {
  const info = detectToolchain('typescript', fakeRunner({ 'node --version': 'v22.14.0' }));
  const npm = info.tools.find(t => t.command === 'npm')!;
  assert.equal(npm.present, false);
  assert.equal(npm.version, undefined);
  assert.equal(info.ready, false);
});

test('python probe detects python on PATH', () => {
  const info = detectToolchain('python', fakeRunner({ 'python --version': 'Python 3.12.4' }));
  assert.equal(info.ready, true);
  assert.equal(info.tools[0].version, 'Python 3.12.4');
});

// ── The .NET deep probe (lifted from Desktop dotnetInfo.ts) ───────────────────────────────────

test('parseSdkList pulls version strings from real --list-sdks output', () => {
  assert.deepEqual(parseSdkList(LIST_SDKS), ['6.0.428', '8.0.404', '10.0.301']);
  assert.deepEqual(parseSdkList(''), []);
});

test('parseRuntimeMajors counts only Microsoft.NETCore.App majors, deduped + sorted', () => {
  assert.deepEqual(parseRuntimeMajors(LIST_RUNTIMES), [6, 8, 10]);
  assert.deepEqual(parseRuntimeMajors(''), []);
});

test('pickTfm prefers net8.0 (LTS) when an 8.x runtime exists, else the newest major', () => {
  assert.equal(pickTfm([6, 8, 10]), 'net8.0');
  assert.equal(pickTfm([9, 10]), 'net10.0');
  assert.equal(pickTfm([]), undefined);
});

test('detectDotnet assembles DotnetInfo from the two list commands', () => {
  const info = detectDotnet(fakeRunner({
    'dotnet --list-sdks': LIST_SDKS,
    'dotnet --list-runtimes': LIST_RUNTIMES,
  }));
  assert.deepEqual(info, { hasSdk: true, sdks: ['6.0.428', '8.0.404', '10.0.301'], runtimeMajors: [6, 8, 10], tfm: 'net8.0' });
});

test('detectDotnet with no dotnet on PATH -> empty, hasSdk=false, no tfm', () => {
  assert.deepEqual(detectDotnet(fakeRunner({})), { hasSdk: false, sdks: [], runtimeMajors: [], tfm: undefined });
});
