/**
 * Minimal semver helpers for Dependabot-style update classification.
 * Avoids a hard dependency on the `semver` package in the published CLI bundle.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

/** Strip common range operators and extract the first x.y.z. */
export function coerceVersion(raw: string): ParsedVersion | null {
  const cleaned = raw
    .trim()
    .replace(/^workspace:/, '')
    .replace(/^npm:/, '')
    .replace(/^file:.*/, '')
    .replace(/^link:.*/, '')
    .replace(/^[\^~>=<\s]+/, '')
    .replace(/\s+.*$/, '');
  if (!cleaned || cleaned === '*' || cleaned.startsWith('http')) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(cleaned);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? '',
  };
}

export function versionToString(v: ParsedVersion): string {
  return v.prerelease
    ? `${v.major}.${v.minor}.${v.patch}-${v.prerelease}`
    : `${v.major}.${v.minor}.${v.patch}`;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export type UpdateKind = 'major' | 'minor' | 'patch' | 'none';

export function classifyUpdate(
  currentRaw: string,
  latestRaw: string,
): UpdateKind {
  const current = coerceVersion(currentRaw);
  const latest = coerceVersion(latestRaw);
  if (!current || !latest) return 'none';
  if (compareVersions(latest, current) <= 0) return 'none';
  if (latest.major !== current.major) return 'major';
  if (latest.minor !== current.minor) return 'minor';
  if (latest.patch !== current.patch || latest.prerelease !== current.prerelease) {
    return 'patch';
  }
  return 'none';
}

/** Prefer a target version that matches the configured update policy. */
export function pickTargetVersion(
  currentRaw: string,
  latestRaw: string,
  allowed: ReadonlyArray<'major' | 'minor' | 'patch'>,
  versionsDescending: string[],
): string | null {
  const kind = classifyUpdate(currentRaw, latestRaw);
  if (kind !== 'none' && allowed.includes(kind)) {
    return coerceVersion(latestRaw) ? versionToString(coerceVersion(latestRaw)!) : latestRaw;
  }

  const current = coerceVersion(currentRaw);
  if (!current) return null;

  for (const candidate of versionsDescending) {
    const parsed = coerceVersion(candidate);
    if (!parsed) continue;
    if (compareVersions(parsed, current) <= 0) continue;
    const k = classifyUpdate(versionToString(current), versionToString(parsed));
    if (k !== 'none' && allowed.includes(k)) {
      return versionToString(parsed);
    }
  }
  return null;
}
