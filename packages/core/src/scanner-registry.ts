import type { LanguageId, LanguageScanner } from './language.js';

/**
 * Registry of language scanners. The CLI looks up scanners by detected language;
 * never hard-code a language implementation in Classify / Fix / PR stages.
 */
const scanners = new Map<LanguageId, LanguageScanner>();

export function registerScanner(scanner: LanguageScanner): void {
  scanners.set(scanner.language, scanner);
}

export function getScanner(language: LanguageId): LanguageScanner | undefined {
  return scanners.get(language);
}

export function listRegisteredScanners(): LanguageScanner[] {
  return [...scanners.values()];
}

/**
 * Resolve scanners for a repo: registered scanners whose detects() is true,
 * optionally filtered by an explicit config.languages list.
 */
export function resolveScannersForRepo(
  repoRoot: string,
  configuredLanguages?: LanguageId[],
): LanguageScanner[] {
  const all = listRegisteredScanners();
  const detected = all.filter((s) => s.detects(repoRoot));

  if (!configuredLanguages || configuredLanguages.length === 0) {
    return detected.length > 0 ? detected : all.filter((s) => s.language === 'typescript');
  }

  const allowed = new Set(configuredLanguages);
  const matched = detected.filter((s) => allowed.has(s.language));
  // If config lists a language that isn't detected, still try registered scanners
  // for those ids (useful for monorepos where markers live in subdirs).
  if (matched.length === 0) {
    return all.filter((s) => allowed.has(s.language));
  }
  return matched;
}
