import * as fs from 'fs';
import * as path from 'path';
import { TargetLanguage } from '../adapters/CodeEmitter';
import { detectDotnet, detectToolchain, probeVersion, DotnetInfo, ProbeRunner } from './toolchainDetection';

/**
 * The managed local sandbox (SBX-1) — a minimal runnable test project the app lays down (once) so
 * local Execute genuinely builds + runs, without ever touching the user's workspace (deploy model
 * v2). Lifted from Desktop `sandboxProject.ts`; the vitest scaffold is the NF-2 half, created here.
 *
 * We **detect, never install** system software: no SDK/toolchain → an honest `ok: false` with an
 * actionable reason. Project dependencies are declared by the scaffold; for TS they are installed
 * as a separate, explicit client step (`npm install` through the user's own registry — never
 * bundled), surfaced via `depsReady`. C# deps arrive via NuGet restore at build time, as always.
 *
 * Client boundaries: the caller supplies `dir` (its data-dir location) and keeps the edition gate
 * and runner-config persistence.
 */

// Pinned package versions present in a normal NuGet cache, so restore works offline.
const TEST_SDK = '17.14.1';
const MSTEST = '3.6.4';
const BOGUS = '35.6.5'; // DataGenerator.cs (the Data Library) is Bogus-backed (`new Faker()`)

// TS dev-dependency ranges — resolved through the user's own npm registry at install time.
const TS_DEV_DEPS: Record<string, string> = {
  typescript: '^5.9.0',
  vitest: '^3.2.0',
  '@faker-js/faker': '^9.0.0',
};

export interface EnsureSandboxOptions {
  /** Injectable .NET probe result (tests); defaults to a live `detectDotnet()`. */
  dotnet?: DotnetInfo;
  /** Injectable probe runner for toolchain detection (tests); defaults to the real prober. */
  run?: ProbeRunner;
}

export interface EnsureSandboxResult {
  ok: boolean;
  /** Human-readable reason when ok is false (shown to the user, e.g. "install the .NET SDK"). */
  reason?: string;
  /** What the runner takes: the `.csproj` path (C#) or the project directory (TS). */
  projectPath?: string;
  /** Chosen target framework (C# only). */
  tfm?: string;
  /** TS/Python only: whether the declared dependencies are installed (node_modules / importable). */
  depsReady?: boolean;
}

/** The scaffolded .csproj contents for a given target framework. */
function csprojFor(tfm: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${tfm}</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="${TEST_SDK}" />
    <PackageReference Include="MSTest.TestAdapter" Version="${MSTEST}" />
    <PackageReference Include="MSTest.TestFramework" Version="${MSTEST}" />
    <PackageReference Include="Bogus" Version="${BOGUS}" />
  </ItemGroup>
</Project>
`;
}

/** Write only when the content differs (avoids needless restores / watcher churn). */
function writeIfChanged(filePath: string, content: string): void {
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function scaffoldCSharp(dir: string, opts: EnsureSandboxOptions): EnsureSandboxResult {
  const info = opts.dotnet ?? detectDotnet(opts.run);
  if (!info.hasSdk || !info.tfm) {
    return { ok: false, reason: 'No .NET SDK found on this machine. Install the .NET SDK, then run again.' };
  }
  fs.mkdirSync(dir, { recursive: true });
  const projectPath = path.join(dir, 'sandbox.csproj');
  writeIfChanged(projectPath, csprojFor(info.tfm));
  return { ok: true, tfm: info.tfm, projectPath };
}

function scaffoldTypeScript(dir: string, opts: EnsureSandboxOptions): EnsureSandboxResult {
  const toolchain = detectToolchain('typescript', ...(opts.run ? [opts.run] as const : []));
  const missing = toolchain.tools.filter(t => !t.present);
  if (missing.length) {
    return { ok: false, reason: `Missing on this machine: ${missing.map(t => t.name).join(', ')}. Install Node.js LTS (npm ships with it), then run again.` };
  }
  fs.mkdirSync(dir, { recursive: true });

  // The compile contract: same settings the TS emit layer is proven against (strict tsc in the
  // emitter tests). skipLibCheck keeps third-party .d.ts noise out of the user's runs.
  writeIfChanged(path.join(dir, 'package.json'), JSON.stringify({
    name: 'api2test-sandbox',
    private: true,
    devDependencies: TS_DEV_DEPS,
  }, null, 2) + '\n');
  writeIfChanged(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['**/*.ts'],
  }, null, 2) + '\n');

  const depsReady = Object.keys(TS_DEV_DEPS).every(dep => fs.existsSync(path.join(dir, 'node_modules', dep)));
  return { ok: true, projectPath: dir, depsReady };
}

// Python sandbox deps — what the generated code imports (pytest runs it, api_methods.py uses
// requests, data_generator.py uses faker). Unpinned: resolved through the user's own pip index.
const PY_DEPS = ['pytest', 'requests', 'faker'];

function scaffoldPython(dir: string, opts: EnsureSandboxOptions): EnsureSandboxResult {
  const toolchain = detectToolchain('python', ...(opts.run ? [opts.run] as const : []));
  const missing = toolchain.tools.filter(t => !t.present);
  if (missing.length) {
    return { ok: false, reason: `Missing on this machine: ${missing.map(t => t.name).join(', ')}. Install Python 3 from python.org, then run again.` };
  }
  fs.mkdirSync(dir, { recursive: true });
  writeIfChanged(path.join(dir, 'requirements.txt'), PY_DEPS.join('\n') + '\n');

  // pip installs globally/per-user rather than into the project dir, so "installed?" is answered by
  // the interpreter itself: can it import the declared packages? (print so success has stdout).
  const run = opts.run ?? probeVersion;
  const depsReady = run('python', ['-c', `import ${PY_DEPS.join(', ')}; print('ok')`]) !== null;
  return { ok: true, projectPath: dir, depsReady };
}

/** Per-language sandbox scaffolders — one per shipped TargetLanguage. */
export const SANDBOX_SCAFFOLDERS: Partial<Record<TargetLanguage, (dir: string, opts: EnsureSandboxOptions) => EnsureSandboxResult>> = {
  csharp: scaffoldCSharp,
  typescript: scaffoldTypeScript,
  python: scaffoldPython,
};

/**
 * Ensure a runnable sandbox project for `language` exists under `dir`. Idempotent — safe to call
 * before every run. **Installs nothing**: missing toolchain → `ok: false` with a reason, so the
 * caller reports honestly instead of faking a result.
 */
export function ensureSandbox(language: TargetLanguage, dir: string, opts: EnsureSandboxOptions = {}): EnsureSandboxResult {
  const scaffold = SANDBOX_SCAFFOLDERS[language];
  if (!scaffold) {
    return { ok: false, reason: `No local sandbox for '${language}' yet (arrives with its runner — PY-1).` };
  }
  return scaffold(dir, opts);
}
