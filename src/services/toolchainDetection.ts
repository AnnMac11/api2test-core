import { execFileSync } from 'child_process';
import type { TargetLanguage } from '../adapters/CodeEmitter';

/**
 * Toolchain detection — what the local machine has for building/running generated tests, per target
 * language. One implementation shared by every edition (lifts Desktop `dotnetInfo.ts` + the VS Code
 * `environment.ts` toolchain half, which had already drifted apart).
 *
 * We **detect, never install** — corporate machines control their own SDK/runtime versions and often
 * block installs. Consumers surface what's missing and let the user re-check.
 *
 * The shared shape is language-symmetric: every `TargetLanguage` gets the same `{ tools, ready }`
 * treatment via `TOOLCHAIN_PROBES` — no language is special-cased. Language-specific depth (the .NET
 * SDK/runtime/tfm probe the sandbox scaffold needs) lives in its own function (`detectDotnet`), not
 * as a privileged field on the shared shape.
 */

/** Runs a probe command, returning trimmed stdout or null when the tool is absent/failed. Injectable for tests. */
export type ProbeRunner = (cmd: string, args: string[]) => string | null;

/** One machine tool's detection result. */
export interface ToolStatus {
  /** Display name, e.g. ".NET SDK". */
  name: string;
  /** The probed command, e.g. "dotnet". */
  command: string;
  present: boolean;
  /** The probe's output when present (e.g. "v22.14.0"). */
  version?: string;
}

/** The toolchain a target language needs, with live detection results. */
export interface ToolchainInfo {
  language: TargetLanguage;
  tools: ToolStatus[];
  /** True when every tool is present. */
  ready: boolean;
}

interface ToolProbe {
  name: string;
  command: string;
  args: string[];
}

/** The probe table — one entry per TargetLanguage, all languages equal citizens. */
export const TOOLCHAIN_PROBES: Record<TargetLanguage, ToolProbe[]> = {
  csharp: [
    { name: '.NET SDK', command: 'dotnet', args: ['--version'] },
  ],
  typescript: [
    { name: 'Node.js', command: 'node', args: ['--version'] },
    { name: 'npm', command: 'npm', args: ['--version'] },
  ],
  python: [
    { name: 'Python', command: 'python', args: ['--version'] },
  ],
};

/**
 * Default runner. On Windows we invoke through `cmd /c` so `.cmd`/`.bat` shims (npm/npx are
 * `npm.cmd`) resolve via PATHEXT — `execFileSync` on the bare name can't find them. Args are a real
 * array (NOT `shell: true`, which concatenates unescaped and triggers Node's DEP0190).
 */
export function probeVersion(cmd: string, args: string[]): string | null {
  const [bin, binArgs] = process.platform === 'win32'
    ? ['cmd', ['/c', cmd, ...args]]
    : [cmd, args];
  try {
    const out = execFileSync(bin, binArgs, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null; // not on PATH, or the command failed — treat as "not present"
  }
}

/** Probe the machine for a target language's toolchain. Pure read — installs nothing. */
export function detectToolchain(language: TargetLanguage, run: ProbeRunner = probeVersion): ToolchainInfo {
  const tools = TOOLCHAIN_PROBES[language].map(({ name, command, args }): ToolStatus => {
    const version = run(command, args)?.trim();
    return version
      ? { name, command, present: true, version }
      : { name, command, present: false };
  });
  return { language, tools, ready: tools.every(t => t.present) };
}

// ── .NET deep probe (lifted from Desktop dotnetInfo.ts) ─────────────────────────────────────────

/** What the machine has for running C# tests — feeds the sandbox scaffold's framework choice. */
export interface DotnetInfo {
  /** True when at least one .NET SDK is on PATH. */
  hasSdk: boolean;
  /** Installed SDK version strings (e.g. "10.0.301"). */
  sdks: string[];
  /** Installed `Microsoft.NETCore.App` runtime majors (e.g. [8, 9, 10]). */
  runtimeMajors: number[];
  /** Target framework we can build+run without downloading a targeting pack (e.g. "net8.0"). */
  tfm?: string;
}

/** "10.0.301 [C:\...]" lines -> ["10.0.301"]. */
export function parseSdkList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(/\s+/)[0]);
}

/** `--list-runtimes` output -> installed Microsoft.NETCore.App majors, deduped + ascending. */
export function parseRuntimeMajors(output: string): number[] {
  const majors = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const m = line.trim().match(/^Microsoft\.NETCore\.App\s+(\d+)\./);
    if (m) majors.add(Number(m[1]));
  }
  return [...majors].sort((a, b) => a - b);
}

/**
 * Pick a target framework the machine can build+run with no extra download. Prefer **net8.0** when an
 * 8.x runtime is present (LTS, widest NuGet-package compatibility, and the combo verified to restore
 * offline); otherwise the newest installed major.
 */
export function pickTfm(runtimeMajors: number[]): string | undefined {
  if (!runtimeMajors.length) return undefined;
  if (runtimeMajors.includes(8)) return 'net8.0';
  return `net${Math.max(...runtimeMajors)}.0`;
}

/** Probe the machine for the .NET SDK + runtimes. Pure read — shells `dotnet --list-*`, installs nothing. */
export function detectDotnet(run: ProbeRunner = probeVersion): DotnetInfo {
  const sdks = parseSdkList(run('dotnet', ['--list-sdks']) ?? '');
  const runtimeMajors = parseRuntimeMajors(run('dotnet', ['--list-runtimes']) ?? '');
  return { hasSdk: sdks.length > 0, sdks, runtimeMajors, tfm: pickTfm(runtimeMajors) };
}
