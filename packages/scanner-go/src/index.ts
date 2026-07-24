import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGUAGE_MARKERS,
  type FixInstruction,
  type LanguageScanner,
  type MatchSite,
} from '@patch-dev/core';

export const KNOWN_LIMITATIONS = [
  'Go scanner is a stub — implement go/ast or tree-sitter based matching.',
  'Planned: resolve import paths from go.mod, then find selector/call expressions.',
] as const;

/**
 * Stub LanguageScanner for Go.
 */
export class GoScanner implements LanguageScanner {
  readonly language = 'go' as const;
  readonly name = 'Go';
  readonly extensions = LANGUAGE_MARKERS.go.extensions;
  readonly limitations = KNOWN_LIMITATIONS;
  private warned = false;

  detects(repoRoot: string): boolean {
    return LANGUAGE_MARKERS.go.files.some((f) => existsSync(join(repoRoot, f)));
  }

  scan(instruction: FixInstruction, _options: { repoRoot: string }): MatchSite[] {
    const hint = instruction.match_pattern.language;
    if (hint && hint !== 'go') return [];
    if (!this.warned) {
      this.warned = true;
      console.warn(
        '[patch] Go scanner is not implemented yet — skipping .go call-site matches. See docs/languages.md.',
      );
    }
    return [];
  }
}

export function createScanner(): LanguageScanner {
  return new GoScanner();
}
