import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGUAGE_MARKERS,
  type FixInstruction,
  type LanguageScanner,
  type MatchSite,
} from '@patch-dev/core';

export const KNOWN_LIMITATIONS = [
  'Python scanner is a stub — implement LibCST or tree-sitter based matching.',
  'Planned: resolve `import x` / `from x import y` / aliases, then find call sites.',
] as const;

/**
 * Stub LanguageScanner for Python.
 * detects() works today so `patch scan` can report the language;
 * scan() returns [] until the real implementation lands.
 */
export class PythonScanner implements LanguageScanner {
  readonly language = 'python' as const;
  readonly name = 'Python';
  readonly extensions = LANGUAGE_MARKERS.python.extensions;
  readonly limitations = KNOWN_LIMITATIONS;
  private warned = false;

  detects(repoRoot: string): boolean {
    return LANGUAGE_MARKERS.python.files.some((f) => existsSync(join(repoRoot, f)));
  }

  scan(instruction: FixInstruction, _options: { repoRoot: string }): MatchSite[] {
    const hint = instruction.match_pattern.language;
    if (hint && hint !== 'python') return [];
    if (!this.warned) {
      this.warned = true;
      console.warn(
        '[patch] Python scanner is not implemented yet — skipping .py call-site matches. See docs/languages.md.',
      );
    }
    return [];
  }
}

export function createScanner(): LanguageScanner {
  return new PythonScanner();
}
