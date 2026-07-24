import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGUAGE_MARKERS,
  type FixInstruction,
  type LanguageScanner,
  type MatchSite,
} from '@patch-dev/core';

export const KNOWN_LIMITATIONS = [
  'Rust scanner is a stub — implement syn / rust-analyzer based matching.',
  'Planned: resolve `use crate::…` / `extern crate`, then find method/function call sites.',
] as const;

/**
 * Stub LanguageScanner for Rust.
 */
export class RustScanner implements LanguageScanner {
  readonly language = 'rust' as const;
  readonly name = 'Rust';
  readonly extensions = LANGUAGE_MARKERS.rust.extensions;
  readonly limitations = KNOWN_LIMITATIONS;
  private warned = false;

  detects(repoRoot: string): boolean {
    return LANGUAGE_MARKERS.rust.files.some((f) => existsSync(join(repoRoot, f)));
  }

  scan(instruction: FixInstruction, _options: { repoRoot: string }): MatchSite[] {
    const hint = instruction.match_pattern.language;
    if (hint && hint !== 'rust') return [];
    if (!this.warned) {
      this.warned = true;
      console.warn(
        '[patch] Rust scanner is not implemented yet — skipping .rs call-site matches. See docs/languages.md.',
      );
    }
    return [];
  }
}

export function createScanner(): LanguageScanner {
  return new RustScanner();
}
