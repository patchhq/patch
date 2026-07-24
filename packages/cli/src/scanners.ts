import {
  registerScanner,
  resolveScannersForRepo,
  type LanguageId,
  type LanguageScanner,
  type FixInstruction,
  type MatchSite,
} from '@patch-dev/core';
import { TypescriptScanner } from '@patch-dev/scanner-ts';
import { PythonScanner } from '@patch-dev/scanner-python';
import { RustScanner } from '@patch-dev/scanner-rust';
import { GoScanner } from '@patch-dev/scanner-go';
import { scanPackageJsonManifest } from './manifest-scanner.js';

let registered = false;

/** Register all built-in language scanners once per process. */
export function ensureScannersRegistered(): void {
  if (registered) return;
  registerScanner(new TypescriptScanner());
  registerScanner(new PythonScanner());
  registerScanner(new RustScanner());
  registerScanner(new GoScanner());
  registered = true;
}

/**
 * Scan with every active language scanner for this repo.
 * Results are deduped by file:line:column.
 * Dependabot-style bumps also search package.json via the manifest scanner.
 */
export function scanWithLanguages(
  instruction: FixInstruction,
  repoRoot: string,
  configuredLanguages?: LanguageId[],
): { sites: MatchSite[]; scanners: LanguageScanner[] } {
  ensureScannersRegistered();
  const scanners = resolveScannersForRepo(repoRoot, configuredLanguages);
  const sites: MatchSite[] = [];
  const seen = new Set<string>();

  const add = (site: MatchSite, language?: string) => {
    const key = `${site.file}:${site.line}:${site.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    sites.push({
      ...site,
      language: site.language ?? (language as MatchSite['language']),
    });
  };

  for (const scanner of scanners) {
    for (const site of scanner.scan(instruction, { repoRoot })) {
      add(site, scanner.language);
    }
  }

  for (const site of scanPackageJsonManifest(instruction, repoRoot)) {
    add(site);
  }

  return {
    sites: sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    scanners,
  };
}
