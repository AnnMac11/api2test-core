import * as fs from 'fs';
import * as path from 'path';
import { CodeEmitter, TargetLanguage } from '../adapters/CodeEmitter';
import { librariesDir, classesDir, testsDir, librariesNs } from './generatedNamespaces';
import { ApiMethodForGeneration } from './generateApiMethodsCSharp';
import { DataMethodCode } from './generateDataLibrary';
import { runDotnetBuild, runTsc, BuildResult } from './TestRunnerService';

/**
 * deployUnit — the one code path that turns a set of test cases into a **complete compilable unit**
 * on disk (DEP-1, lifted from Desktop `deployUnit.ts`/`deployLibraries.ts`/`deploy.ts`):
 *
 *   collision guard → (clean) → shared libraries → each test + the generated classes it references
 *
 * Language-symmetric: everything idiom-bound (file names, library emission) comes from the
 * {@link CodeEmitter}; the folder layout comes from `generatedNamespaces` (folder == namespace,
 * shared across languages). Both "Run in Sandbox" and "Promote/Deploy to a destination" call this,
 * so a promoted suite compiles exactly like it did in the sandbox.
 *
 * Client boundaries (same ruling as ORCH): the generated-class store and the library method lists
 * stay client-side — classes come in via `resolveClass`, methods via `apiMethods`/`dataMethods`.
 */

/** A test case enriched with what deployment needs. */
export interface DeployCase {
  id: string;
  name: string;
  /** The test's current (possibly user-edited) generated code. Empty/missing → skipped. */
  code?: string;
  /** Owning application — decides the Tests/<App> folder. */
  application: string;
  /** Names of the generated request classes this test references (deployed alongside it). */
  classRefs?: string[];
}

/** A generated class resolved from the client's store. */
export interface ResolvedClass { code: string; application?: string }

export interface DeployUnitOptions {
  /** Target project root directory (sandbox or destination working copy). */
  root: string;
  /** Language emitter — supplies library emission + the idiom-bound file names. */
  emitter: CodeEmitter;
  /** Resolve a referenced generated class by name (client's store). Unresolvable refs are skipped. */
  resolveClass?: (className: string) => ResolvedClass | undefined;
  /** API Method Library to emit as the shared ApiMethods source. Empty → no file written. */
  apiMethods?: ApiMethodForGeneration[];
  /** Data Library to emit as the shared DataGenerator source. Empty → no file written. */
  dataMethods?: DataMethodCode[];
  /**
   * Remove previously-deployed generated Classes/ + Tests/ first, so the run contains ONLY what it
   * deploys now (a stale non-compiling leftover must not fail an unrelated test's build). Sandbox
   * semantics — leave false for a regression/destination project, which accumulates promoted suites.
   */
  clean?: boolean;
}

export interface DeployUnitResult {
  /** Absolute paths of every file written, in deploy order. */
  files: string[];
  /** Ids of cases skipped because they have no generated code. */
  notGenerated: string[];
  /** Class names deployed (deduped). */
  deployedClasses: string[];
}

/** Sanitise a display name into a code-safe artifact base name (e.g. "Create Pet!" -> "CreatePet"). */
export function safeArtifactName(name: string): string {
  return (name || 'TestCase').replace(/[^a-zA-Z0-9]+/g, '') || 'TestCase';
}

/**
 * Reduce `fileName` to a single safe path segment — strips any directory / traversal so a crafted
 * name (e.g. `..\..\Startup\x.bat`) can never escape the target folder. Only the final segment
 * survives, restricted to `[A-Za-z0-9._-]`.
 */
export function safeFileName(fileName: string): string {
  const base = path.posix.basename(String(fileName || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`Invalid deploy file name: "${fileName}"`);
  return cleaned;
}

/** The project root directory (a .csproj's folder, or the configured folder itself). */
export function projectDirOf(testProjectPath: string): string {
  return /\.csproj$/i.test(testProjectPath) ? path.dirname(testProjectPath) : testProjectPath;
}

/**
 * Remove previously-deployed generated **Classes/** and **Tests/** under `root`. `Libraries/` is
 * kept (redeployed on every unit). Best-effort; safe if the dirs don't exist.
 */
export function cleanGeneratedArtifacts(root: string): void {
  const firstSeg = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean)[0];
  const roots = new Set([firstSeg(classesDir('X')), firstSeg(testsDir('X'))].filter(Boolean) as string[]);
  for (const seg of roots) {
    try { fs.rmSync(path.join(root, seg), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeArtifact(root: string, subDir: string, fileName: string, content: string): string {
  const dir = path.join(root, subDir);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, safeFileName(fileName));
  fs.writeFileSync(outFile, content, 'utf8');
  return outFile;
}

/** Deploy the complete compilable unit for `cases` into `opts.root`. */
export function deployUnit(cases: DeployCase[], opts: DeployUnitOptions): DeployUnitResult {
  const { root, emitter } = opts;

  // Fail loudly on a name collision BEFORE deploying anything: two generated cases whose sanitised
  // name matches (case-insensitively) would overwrite each other's test file and get cross-mapped to
  // the wrong result. Catch it here so the user renames one, instead of a silent wrong run.
  const byKey = new Map<string, string>();
  for (const c of cases) {
    if (!(c.code && c.code.trim())) continue;
    const key = safeArtifactName(c.name).toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      throw new Error(
        `Test case name collision: "${prev}" and "${c.name}" both map to the same test file ` +
        `(${emitter.testFileName(safeArtifactName(c.name))}). Rename one so they don't overwrite each other.`,
      );
    }
    byKey.set(key, c.name);
  }

  if (opts.clean) cleanGeneratedArtifacts(root);

  const files: string[] = [];

  // Libraries first — the classes/tests compile against them (same shared namespace/layout).
  if (opts.apiMethods?.length) {
    const code = emitter.emitApiMethods(opts.apiMethods, {
      namespace: librariesNs(),
      className: 'ApiMethods',
      includeUsingStatements: true,
      includeApiClient: true,
    });
    files.push(writeArtifact(root, librariesDir(), emitter.libraryFileNames.apiMethods, code));
  }
  if (opts.dataMethods?.length) {
    files.push(writeArtifact(root, librariesDir(), emitter.libraryFileNames.dataLibrary, emitter.emitDataLibrary(opts.dataMethods)));
  }

  const notGenerated: string[] = [];
  const deployedClasses = new Set<string>();
  for (const c of cases) {
    if (!(c.code && c.code.trim())) { notGenerated.push(c.id); continue; }
    const app = c.application || 'Default';
    files.push(writeArtifact(root, testsDir(app), emitter.testFileName(safeArtifactName(c.name)), c.code));
    // … and the generated classes it references, so the test compiles.
    for (const ref of c.classRefs || []) {
      if (!ref || deployedClasses.has(ref)) continue;
      const cls = opts.resolveClass?.(ref);
      if (cls) {
        files.push(writeArtifact(root, classesDir(cls.application || app), emitter.classFileName(safeArtifactName(ref)), cls.code));
        deployedClasses.add(ref);
      }
    }
  }
  return { files, notGenerated, deployedClasses: [...deployedClasses] };
}

/**
 * Build-validate a deployed unit, per language. `csharp` builds the project (`dotnet build`),
 * `typescript` type-checks it (`tsc --noEmit`). Python arrives with its runner (PY-1).
 */
export const BUILD_VALIDATORS: Partial<Record<TargetLanguage, (projectPath: string) => Promise<BuildResult>>> = {
  csharp: (projectPath) => runDotnetBuild(projectPath),
  typescript: (projectPath) => runTsc(projectDirOf(projectPath)),
};

/** Build-validate `projectPath` with the language's validator. Throws for a language with no runner yet. */
export function buildDeployedUnit(language: TargetLanguage, projectPath: string): Promise<BuildResult> {
  const validate = BUILD_VALIDATORS[language];
  if (!validate) throw new Error(`No build validator for language '${language}' yet.`);
  return validate(projectPath);
}
