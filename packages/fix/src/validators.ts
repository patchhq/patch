import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import type { CheckResult, LanguageId, LanguageValidator } from '@patch-dev/core';

const require = createRequire(import.meta.url);

const OUTPUT_CAP = 12_000;

function truncate(text: string): string {
  if (text.length <= OUTPUT_CAP) return text;
  return `${text.slice(0, OUTPUT_CAP)}\n…[truncated]`;
}

function combineOutput(result: {
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error | null;
}): string {
  const toText = (v: string | Buffer | null | undefined) =>
    v == null ? '' : typeof v === 'string' ? v : v.toString('utf8');
  const parts = [toText(result.stdout), toText(result.stderr)].filter(Boolean);
  if (result.error) parts.push(String(result.error.message));
  return truncate(parts.join('\n').trim());
}

function spawn(
  command: string,
  args: string[],
  cwd: string,
): ReturnType<typeof spawnSync> {
  const bin =
    process.platform === 'win32' && ['npm', 'npx'].includes(command)
      ? `${command}.cmd`
      : command;
  return spawnSync(bin, args, { cwd, encoding: 'utf8' });
}

function runTsc(cwd: string): ReturnType<typeof spawnSync> {
  try {
    const tscJs = require.resolve('typescript/lib/tsc.js');
    return spawnSync(process.execPath, [tscJs, '--noEmit', '-p', 'tsconfig.json'], {
      cwd,
      encoding: 'utf8',
    });
  } catch {
    return spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsc', '--noEmit', '-p', 'tsconfig.json'],
      cwd,
    );
  }
}

export class TypescriptValidator implements LanguageValidator {
  readonly language = 'typescript' as const;

  typecheck(cwd: string): CheckResult {
    if (!existsSync(join(cwd, 'tsconfig.json'))) {
      return { ok: null, output: '' };
    }
    const result = runTsc(cwd);
    return {
      ok: result.status === 0,
      output: combineOutput(result),
    };
  }

  test(cwd: string): CheckResult {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return { ok: null, output: '' };
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (!pkg.scripts?.['test']) return { ok: null, output: '' };
    const result = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['test', '--', '--passWithNoTests'],
      cwd,
    );
    return {
      ok: result.status === 0,
      output: combineOutput(result),
    };
  }
}

export class PythonValidator implements LanguageValidator {
  readonly language = 'python' as const;

  typecheck(cwd: string): CheckResult {
    if (
      !existsSync(join(cwd, 'mypy.ini')) &&
      !existsSync(join(cwd, 'pyproject.toml'))
    ) {
      return { ok: null, output: '' };
    }
    const result = spawnSync('mypy', ['.'], { cwd, encoding: 'utf8' });
    if (result.error) return { ok: null, output: '' };
    return { ok: result.status === 0, output: combineOutput(result) };
  }

  test(cwd: string): CheckResult {
    if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) {
      const result = spawnSync('pytest', ['-q'], { cwd, encoding: 'utf8' });
      if (result.error) return { ok: null, output: '' };
      return { ok: result.status === 0, output: combineOutput(result) };
    }
    return { ok: null, output: '' };
  }
}

export class RustValidator implements LanguageValidator {
  readonly language = 'rust' as const;

  typecheck(cwd: string): CheckResult {
    if (!existsSync(join(cwd, 'Cargo.toml'))) return { ok: null, output: '' };
    const result = spawnSync('cargo', ['check', '--quiet'], { cwd, encoding: 'utf8' });
    if (result.error) return { ok: null, output: '' };
    return { ok: result.status === 0, output: combineOutput(result) };
  }

  test(cwd: string): CheckResult {
    if (!existsSync(join(cwd, 'Cargo.toml'))) return { ok: null, output: '' };
    const result = spawnSync('cargo', ['test', '--quiet'], { cwd, encoding: 'utf8' });
    if (result.error) return { ok: null, output: '' };
    return { ok: result.status === 0, output: combineOutput(result) };
  }
}

export class GoValidator implements LanguageValidator {
  readonly language = 'go' as const;

  typecheck(cwd: string): CheckResult {
    if (!existsSync(join(cwd, 'go.mod'))) return { ok: null, output: '' };
    const result = spawnSync('go', ['build', './...'], { cwd, encoding: 'utf8' });
    if (result.error) return { ok: null, output: '' };
    return { ok: result.status === 0, output: combineOutput(result) };
  }

  test(cwd: string): CheckResult {
    if (!existsSync(join(cwd, 'go.mod'))) return { ok: null, output: '' };
    const result = spawnSync('go', ['test', './...'], { cwd, encoding: 'utf8' });
    if (result.error) return { ok: null, output: '' };
    return { ok: result.status === 0, output: combineOutput(result) };
  }
}

const validators: Record<LanguageId, LanguageValidator> = {
  typescript: new TypescriptValidator(),
  javascript: new TypescriptValidator(),
  python: new PythonValidator(),
  rust: new RustValidator(),
  go: new GoValidator(),
};

export function getValidator(language: LanguageId | undefined): LanguageValidator {
  if (!language) return validators.typescript;
  return validators[language] ?? validators.typescript;
}

export interface ProjectValidation {
  typecheckPassed: boolean;
  testsPassed: boolean | null;
  typecheckOutput: string;
  testOutput: string;
  /** Which stage failed, if any. */
  failedStage: 'typecheck' | 'test' | null;
  /** Exact error text to feed back to the model. */
  errorOutput: string;
}

/**
 * Run typecheck then tests. Captures compiler/test output for the agentic loop.
 *
 * When `focusFile` is set (per call-site fix), only diagnostics for that file
 * gate success — other still-broken siblings in the same repo do not fail the site.
 */
export function validateProject(
  cwd: string,
  language?: LanguageId,
  options?: { focusFile?: string },
): ProjectValidation {
  const validator = getValidator(language);
  const typecheck = validator.typecheck(cwd);
  const focus = options?.focusFile?.replace(/\\/g, '/');

  if (typecheck.ok === false) {
    const scoped = focus
      ? diagnosticsForFile(typecheck.output, focus)
      : typecheck.output;
    if (!(focus && !scoped.trim())) {
      return {
        typecheckPassed: false,
        testsPassed: null,
        typecheckOutput: typecheck.output,
        testOutput: '',
        failedStage: 'typecheck',
        errorOutput: scoped || typecheck.output || 'Type-check failed with no output.',
      };
    }
  }

  // Per-site fixes: skip whole-repo tests (siblings may still be broken).
  if (focus) {
    return {
      typecheckPassed: true,
      testsPassed: null,
      typecheckOutput: typecheck.output,
      testOutput: '',
      failedStage: null,
      errorOutput: '',
    };
  }

  const tests = validator.test(cwd);
  if (tests.ok === false) {
    return {
      typecheckPassed: true,
      testsPassed: false,
      typecheckOutput: typecheck.output,
      testOutput: tests.output,
      failedStage: 'test',
      errorOutput: tests.output || 'Tests failed with no output.',
    };
  }

  return {
    typecheckPassed: true,
    testsPassed: tests.ok === null ? null : true,
    typecheckOutput: typecheck.output,
    testOutput: tests.output,
    failedStage: null,
    errorOutput: '',
  };
}

/** Keep tsc lines that reference the given repo-relative file. */
export function diagnosticsForFile(tscOutput: string, focusFile: string): string {
  const norm = focusFile.replace(/\\/g, '/');
  const base = norm.split('/').pop() ?? norm;
  return tscOutput
    .split(/\r?\n/)
    .filter((line) => {
      const m = /^(.+?)\(\d+,\d+\):/.exec(line);
      if (!m) return false;
      const file = m[1]!.replace(/\\/g, '/');
      return (
        file === norm ||
        file.endsWith(`/${norm}`) ||
        file.endsWith(`/${base}`) ||
        file === base
      );
    })
    .join('\n');
}
