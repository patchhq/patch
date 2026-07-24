import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  contentHash,
  type Connector,
  type RawChange,
  type RawSource,
} from '@patch-dev/core';
import {
  classifyUpdate,
  coerceVersion,
  compareVersions,
  pickTargetVersion,
  versionToString,
  type UpdateKind,
} from './semver.js';

export type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies';

export interface DependencyUpdateOptions {
  /** Absolute path to the consumer repo root (package.json lives here). */
  repoRoot: string;
  /** Include package.json sections. Default: dependencies only. */
  includeDevDependencies?: boolean;
  includeOptionalDependencies?: boolean;
  /**
   * Which bump sizes to open updates for (Dependabot-style).
   * Default: patch + minor (majors opt-in).
   */
  updateTypes?: Array<'major' | 'minor' | 'patch'>;
  /** Package names to watch. Empty/undefined = all in selected sections. */
  allow?: string[];
  /** Package names to skip. */
  deny?: string[];
  /** When true, only emit packages with a known OSV vulnerability. */
  securityOnly?: boolean;
  fetchImpl?: typeof fetch;
}

export interface DepRecord {
  name: string;
  section: DependencySection;
  range: string;
  current: string;
  latest: string;
  target: string;
  updateKind: UpdateKind;
  security: boolean;
  advisoryIds: string[];
  advisorySummary?: string;
}

interface SnapshotPayload {
  packages: DepRecord[];
}

function readManifest(repoRoot: string): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
} {
  const path = join(repoRoot, 'package.json');
  if (!existsSync(path)) {
    throw new Error(`dependency-update: no package.json in ${repoRoot}`);
  }
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  return {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
  };
}

function shouldWatch(
  name: string,
  options: DependencyUpdateOptions,
): boolean {
  if (options.deny?.includes(name)) return false;
  if (options.allow && options.allow.length > 0) {
    return options.allow.includes(name);
  }
  // Skip workspace / local / URL protocols
  return true;
}

function isWatchableRange(range: string): boolean {
  if (!range) return false;
  if (/^(workspace:|file:|link:|http:|https:|git\+|github:)/i.test(range)) {
    return false;
  }
  return coerceVersion(range) !== null || range === '*' || range.startsWith('^') || range.startsWith('~');
}

async function fetchNpmMeta(
  name: string,
  fetchImpl: typeof fetch,
): Promise<{ latest: string; versions: string[] } | null> {
  const scopedUrl = name.startsWith('@')
    ? `https://registry.npmjs.org/${name.replace('/', '%2F')}`
    : `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const res = await fetchImpl(scopedUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    'dist-tags'?: { latest?: string };
    versions?: Record<string, unknown>;
  };
  const latest = body['dist-tags']?.latest;
  if (!latest) return null;
  const versions = Object.keys(body.versions ?? {}).sort((a, b) => {
    const pa = coerceVersion(a);
    const pb = coerceVersion(b);
    if (!pa || !pb) return b.localeCompare(a);
    return compareVersions(pb, pa);
  });
  return { latest, versions };
}

interface OsvHit {
  id: string;
  summary?: string;
}

async function queryOsv(
  name: string,
  version: string,
  fetchImpl: typeof fetch,
): Promise<OsvHit[]> {
  try {
    const res = await fetchImpl('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: { name, ecosystem: 'npm' },
        version,
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      vulns?: Array<{ id?: string; summary?: string }>;
    };
    return (body.vulns ?? [])
      .filter((v) => v.id)
      .map((v) => ({ id: v.id!, summary: v.summary }));
  } catch {
    return [];
  }
}

function preserveRangePrefix(range: string, targetVersion: string): string {
  const trimmed = range.trim();
  if (trimmed.startsWith('^')) return `^${targetVersion}`;
  if (trimmed.startsWith('~')) return `~${targetVersion}`;
  if (trimmed.startsWith('>=')) return `>=${targetVersion}`;
  return targetVersion;
}

export function createDependencyUpdateConnector(
  id: string,
  options: DependencyUpdateOptions,
): Connector {
  const fetchImpl = options.fetchImpl ?? fetch;
  const updateTypes = options.updateTypes ?? (['patch', 'minor'] as const);

  return {
    id,
    name: 'Dependency updates (Dependabot-style)',

    async fetchRaw(): Promise<RawSource> {
      const manifest = readManifest(options.repoRoot);
      const sections: Array<{
        section: DependencySection;
        deps: Record<string, string>;
      }> = [{ section: 'dependencies', deps: manifest.dependencies }];
      if (options.includeDevDependencies) {
        sections.push({
          section: 'devDependencies',
          deps: manifest.devDependencies,
        });
      }
      if (options.includeOptionalDependencies) {
        sections.push({
          section: 'optionalDependencies',
          deps: manifest.optionalDependencies,
        });
      }

      const packages: DepRecord[] = [];

      for (const { section, deps } of sections) {
        for (const [name, range] of Object.entries(deps)) {
          if (!shouldWatch(name, options)) continue;
          if (!isWatchableRange(range)) continue;

          const meta = await fetchNpmMeta(name, fetchImpl);
          if (!meta) continue;

          const current = coerceVersion(range);
          if (!current && range !== '*') continue;
          const currentStr = current ? versionToString(current) : '0.0.0';

          const target = pickTargetVersion(
            currentStr,
            meta.latest,
            [...updateTypes],
            meta.versions,
          );

          const vulns = await queryOsv(name, currentStr, fetchImpl);
          const security = vulns.length > 0;

          if (options.securityOnly && !security) continue;
          if (!target && !security) continue;

          // For security-only hits with no allowed target, still propose latest patch/minor/latest
          const effectiveTarget =
            target ??
            (security
              ? pickTargetVersion(currentStr, meta.latest, ['patch', 'minor', 'major'], meta.versions) ??
                meta.latest
              : null);
          if (!effectiveTarget) continue;

          const updateKind = classifyUpdate(currentStr, effectiveTarget);
          if (updateKind === 'none' && !security) continue;

          packages.push({
            name,
            section,
            range,
            current: currentStr,
            latest: meta.latest,
            target: preserveRangePrefix(range, effectiveTarget.replace(/^\^|~/, '')),
            updateKind: updateKind === 'none' ? 'patch' : updateKind,
            security,
            advisoryIds: vulns.map((v) => v.id),
            advisorySummary: vulns[0]?.summary,
          });
        }
      }

      packages.sort((a, b) => a.name.localeCompare(b.name));
      const payload: SnapshotPayload = { packages };
      const content = JSON.stringify(payload);

      return {
        connector_id: id,
        content_hash: contentHash(content),
        content,
        fetched_at: new Date().toISOString(),
        metadata: {
          count: packages.length,
          securityCount: packages.filter((p) => p.security).length,
        },
      };
    },

    diff(previous: RawSource | null, current: RawSource): RawChange[] {
      const curr = JSON.parse(current.content) as SnapshotPayload;

      // First scan: surface currently outdated/vulnerable deps (Dependabot-style).
      if (!previous) {
        return curr.packages.map((pkg) => toRawChange(pkg, undefined));
      }

      if (previous.content_hash === current.content_hash) return [];

      const prev = JSON.parse(previous.content) as SnapshotPayload;
      const prevMap = new Map(prev.packages.map((p) => [`${p.section}:${p.name}`, p]));

      const changes: RawChange[] = [];
      for (const pkg of curr.packages) {
        const key = `${pkg.section}:${pkg.name}`;
        const before = prevMap.get(key);
        if (
          before &&
          before.target === pkg.target &&
          before.security === pkg.security &&
          before.current === pkg.current
        ) {
          continue;
        }
        changes.push(toRawChange(pkg, before));
      }

      return changes;
    },
  };
}

function toRawChange(pkg: DepRecord, before: DepRecord | undefined): RawChange {
  const kind = pkg.security ? 'security_advisory' : 'dependency_outdated';
  return {
    kind,
    path: `${pkg.section}.${pkg.name}`,
    before: {
      name: pkg.name,
      section: pkg.section,
      range: before?.range ?? pkg.range,
      version: before?.current ?? pkg.current,
    },
    after: {
      name: pkg.name,
      section: pkg.section,
      range: pkg.target,
      version: coerceVersion(pkg.target)
        ? versionToString(coerceVersion(pkg.target)!)
        : pkg.target,
      latest: pkg.latest,
      updateKind: pkg.updateKind,
      advisoryIds: pkg.advisoryIds,
    },
    excerpt: pkg.security
      ? `Security update ${pkg.name}: ${pkg.current} → ${pkg.target}` +
        (pkg.advisorySummary ? ` (${pkg.advisorySummary})` : '') +
        (pkg.advisoryIds.length ? ` [${pkg.advisoryIds.join(', ')}]` : '')
      : `Dependency update ${pkg.name}: ${pkg.current} → ${pkg.target} (${pkg.updateKind})`,
    structural_confidence: 'high',
  };
}
