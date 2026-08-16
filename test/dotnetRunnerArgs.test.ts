import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dotnetTestArgs, usesTestingPlatform } from '../src/services/TestRunnerService';
import { tmpDir } from './tmp';

/**
 * RUN-TRX — every local run reported "dotnet test produced no TRX", whether the tests passed or failed.
 *
 * The sandbox project is `<Project Sdk="MSTest.Sdk/3.6.4">`, which runs on **Microsoft.Testing.Platform**,
 * not VSTest. MTP does not implement `--logger trx;LogFileName=...`; it writes its own console log and no
 * TRX at all, so the runner found nothing to parse and reported it as a build failure — hiding both the
 * results of a passing run and the real assertion message of a failing one.
 *
 * The flags MTP actually offers (`ApiTests.dll --help`): `--report-trx`, `--report-trx-filename`,
 * `--results-directory`, `--filter`. Under `dotnet test` they are passed to the test app after `--`.
 */

function projectDir(contents: string): string {
  const dir = tmpDir('a2t-runner-');
  fs.writeFileSync(path.join(dir, 'ApiTests.csproj'), contents, 'utf8');
  return dir;
}

const MSTEST_SDK = '<Project Sdk="MSTest.Sdk/3.6.4"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';
const VSTEST = `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup>
  <PackageReference Include="MSTest.TestAdapter" Version="3.6.4" />
  <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
</ItemGroup></Project>`;

test('RUN-TRX: the sandbox project is recognised as a Testing Platform project', () => {
  const dir = projectDir(MSTEST_SDK);
  assert.strictEqual(usesTestingPlatform(dir), true, 'MSTest.Sdk runs on MTP');
  assert.strictEqual(usesTestingPlatform(path.join(dir, 'ApiTests.csproj')), true,
    'the project file itself is accepted, not only its folder');
});

test('RUN-TRX: a classic VSTest project is still recognised as VSTest', () => {
  // Not every project the runner is pointed at is ours — a user's own test project may well be VSTest,
  // and asking IT for --report-trx would break a case that works today.
  assert.strictEqual(usesTestingPlatform(projectDir(VSTEST)), false);
  assert.strictEqual(usesTestingPlatform(path.join(os.tmpdir(), 'a2t-does-not-exist')), false,
    'no project file → assume VSTest, the long-standing behaviour');
});

test('RUN-TRX: an explicit opt-out wins over the SDK', () => {
  // MSTest.Sdk with EnableMSTestRunner=false runs on VSTest — the property is the authority.
  const dir = projectDir('<Project Sdk="MSTest.Sdk/3.6.4"><PropertyGroup><EnableMSTestRunner>false</EnableMSTestRunner></PropertyGroup></Project>');
  assert.strictEqual(usesTestingPlatform(dir), false);
});

test('RUN-TRX: a Testing Platform project is asked for a TRX the way MTP understands', () => {
  const args = dotnetTestArgs('C:/sandbox/csharp', 'C:/sandbox/csharp/.api2test-results', {}, true);
  const sep = args.indexOf('--');
  assert.ok(sep > 0, 'MTP options go to the test app, after the -- separator');
  const appArgs = args.slice(sep + 1);
  assert.ok(appArgs.includes('--report-trx'), 'the TRX report has to be switched on explicitly');
  assert.deepStrictEqual(appArgs.slice(appArgs.indexOf('--report-trx-filename'), appArgs.indexOf('--report-trx-filename') + 2),
    ['--report-trx-filename', 'results.trx'], 'and named, so the runner knows what to parse');
  assert.ok(appArgs.includes('--results-directory') , 'written where the runner looks for it');
  assert.ok(!args.includes('--logger'), 'MTP has no VSTest logger — passing one is what produced no TRX');
});

test('RUN-TRX: a VSTest project keeps the logger arguments it has always used', () => {
  const args = dotnetTestArgs('C:/proj/T.csproj', 'C:/proj/.api2test-results', {}, false);
  assert.deepStrictEqual(args, [
    'test', 'C:/proj/T.csproj', '--logger', 'trx;LogFileName=results.trx',
    '--results-directory', 'C:/proj/.api2test-results',
  ]);
});

test('RUN-TRX: a test-set filter reaches the runner in both flavours', () => {
  // Running one test set is a filter — if it lands on the wrong side of `--` the whole suite runs.
  const mtp = dotnetTestArgs('p', 'r', { filter: 'Name~Testpet' }, true);
  assert.ok(mtp.slice(mtp.indexOf('--') + 1).join(' ').includes('--filter Name~Testpet'),
    'MTP takes the filter as an app option');
  const vstest = dotnetTestArgs('p', 'r', { filter: 'Name~Testpet' }, false);
  assert.ok(vstest.join(' ').includes('--filter Name~Testpet'));
  assert.ok(!vstest.includes('--'), 'VSTest takes it directly — no separator');
});
