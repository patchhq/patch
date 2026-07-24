import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixInstruction, MatchSite } from '@patch-dev/core';

/**
 * Find the package.json line for a Dependabot-style bump_dependency instruction.
 * MatchPattern.import_path = package name; symbol = section (dependencies | …).
 */
export function scanPackageJsonManifest(
  instruction: FixInstruction,
  repoRoot: string,
): MatchSite[] {
  if (instruction.transform.kind !== 'bump_dependency') return [];

  const pkgPath = join(repoRoot, 'package.json');
  if (!existsSync(pkgPath)) return [];

  const name = instruction.match_pattern.import_path;
  const section = instruction.match_pattern.symbol;
  const text = readFileSync(pkgPath, 'utf8');
  const lines = text.split(/\r?\n/);

  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sectionMatch = /^\s*"([^"]+)"\s*:\s*\{/.exec(line);
    if (sectionMatch) {
      inSection = sectionMatch[1] === section;
      continue;
    }
    if (inSection && /^\s*\}/.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    // "lodash": "^4.17.20",
    const depMatch = new RegExp(
      `^(\\s*)"${escapeRegExp(name)}"\\s*:\\s*("([^"]*)")`,
    ).exec(line);
    if (!depMatch) continue;

    return [
      {
        file: 'package.json',
        line: i + 1,
        column: depMatch[1]?.length ?? 0,
        snippet: line.trim(),
        language: 'typescript',
      },
    ];
  }

  return [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
