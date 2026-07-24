import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FixInstruction, MatchSite } from './schemas.js';

/**
 * Languages Patch can scan. MVP ships a TypeScript/JavaScript scanner;
 * Python, Rust, and Go plug in behind the same interface.
 */
export const LanguageIdSchema = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
] as const;
export type LanguageId = (typeof LanguageIdSchema)[number];

/**
 * Codebase scanner for one language.
 * Downstream stages (Fix, Validate, PR) must not special-case languages —
 * they only consume MatchSite[].
 */
export interface LanguageScanner {
  readonly language: LanguageId;

  /** File extensions this scanner owns (including the leading dot). */
  readonly extensions: readonly string[];

  /** Human-readable name for CLI output. */
  readonly name: string;

  /**
   * True when this repo looks like it uses this language.
   * Detection must be cheap (marker files / lockfiles only).
   */
  detects(repoRoot: string): boolean;

  /**
   * Find call / usage sites matching a FixInstruction.
   * MatchPattern.import_path is the language-agnostic module specifier
   * (npm package, Python module, Rust crate path, or Go import path).
   */
  scan(instruction: FixInstruction, options: { repoRoot: string }): MatchSite[];

  /** Documented MVP limitations for this language. */
  readonly limitations: readonly string[];
}

/**
 * Per-language validation after a patch is applied.
 * Confidence ceilings stay the same; only the commands differ.
 */
export interface CheckResult {
  /**
   * true = passed, false = failed, null = checker not configured / unavailable.
   */
  ok: boolean | null;
  /** Captured stdout+stderr (truncated). Empty when ok is null. */
  output: string;
}

export interface LanguageValidator {
  readonly language: LanguageId;

  /**
   * Compile / type-check. ok=null when no checker config is present
   * (treated as "no typecheck available" — moderate confidence ceiling).
   */
  typecheck(cwd: string): CheckResult;

  /**
   * Run the project's test suite. ok=null when no test runner is found.
   */
  test(cwd: string): CheckResult;
}

/** Marker-file heuristics for language detection. */
export const LANGUAGE_MARKERS: Record<
  LanguageId,
  { files: string[]; extensions: string[] }
> = {
  typescript: {
    files: ['tsconfig.json'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
  },
  javascript: {
    files: ['package.json', 'jsconfig.json'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  python: {
    files: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
    extensions: ['.py'],
  },
  rust: {
    files: ['Cargo.toml'],
    extensions: ['.rs'],
  },
  go: {
    files: ['go.mod'],
    extensions: ['.go'],
  },
};

/**
 * Detect which languages a repo uses from marker files.
 * TypeScript implies JavaScript support; we collapse them to 'typescript'
 * when tsconfig.json is present so one scanner covers both.
 */
export function detectLanguages(repoRoot: string): LanguageId[] {
  const found = new Set<LanguageId>();

  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS) as Array<
    [LanguageId, (typeof LANGUAGE_MARKERS)[LanguageId]]
  >) {
    if (markers.files.some((f) => existsSync(join(repoRoot, f)))) {
      found.add(lang);
    }
  }

  // Prefer the TS scanner for JS+TS repos — it handles .js/.jsx via allowJs.
  if (found.has('typescript') && found.has('javascript')) {
    found.delete('javascript');
  }

  return [...found];
}

export function languageDisplayName(id: LanguageId): string {
  switch (id) {
    case 'typescript':
      return 'TypeScript';
    case 'javascript':
      return 'JavaScript';
    case 'python':
      return 'Python';
    case 'rust':
      return 'Rust';
    case 'go':
      return 'Go';
  }
}
