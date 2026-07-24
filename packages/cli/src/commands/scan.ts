import { resolve } from 'node:path';
import {
  loadConfig,
  activeConnectors,
  SqliteSnapshotStore,
  resolveScannersForRepo,
  loadRules,
  type Connector,
  type ConnectorConfig,
  type RawSource,
} from '@patch-dev/core';
import {
  createModelProvider,
  MissingModelKeyError,
  type ModelProvider,
} from '@patch-dev/model';
import { createOpenApiDiffConnector } from '@patch-dev/connector-openapi-diff';
import { createDocScrapeConnector } from '@patch-dev/connector-doc-scrape';
import { createPackageDiffConnector } from '@patch-dev/connector-package-diff';
import { createDependencyUpdateConnector } from '@patch-dev/connector-dependency-update';
import { classifyChanges } from '@patch-dev/classify';
import { generateAndValidateFix } from '@patch-dev/fix';
import {
  publishResults,
  resolveRepoSlug,
  writeLocalReport,
  resolveGithubAuth,
  describeMissingGithubAuth,
} from '@patch-dev/github-app';
import { ensureScannersRegistered, scanWithLanguages } from '../scanners.js';

export interface ScanOptions {
  cwd: string;
  dryRun: boolean;
}

function buildConnector(cfg: ConnectorConfig, cwd: string): Connector {
  const options = { ...cfg.options };
  if (typeof options['localPath'] === 'string') {
    options['localPath'] = resolve(cwd, options['localPath'] as string);
  }

  switch (cfg.type) {
    case 'openapi-diff':
      return createOpenApiDiffConnector(cfg.id, {
        specUrl: String(options['specUrl'] ?? ''),
      });
    case 'doc-scrape':
      return createDocScrapeConnector(cfg.id, {
        urls: (options['urls'] as string[]) ?? [],
        similarityThreshold: options['similarityThreshold'] as number | undefined,
      });
    case 'package-diff':
      return createPackageDiffConnector(cfg.id, {
        package: String(options['package'] ?? cfg.id),
        registry: (options['registry'] as 'npm' | 'pypi') ?? 'npm',
        localPath: options['localPath'] as string | undefined,
      });
    case 'dependency-update':
      return createDependencyUpdateConnector(cfg.id, {
        repoRoot: cwd,
        includeDevDependencies: Boolean(options['includeDevDependencies']),
        includeOptionalDependencies: Boolean(options['includeOptionalDependencies']),
        updateTypes: options['updateTypes'] as
          | Array<'major' | 'minor' | 'patch'>
          | undefined,
        allow: options['allow'] as string[] | undefined,
        deny: options['deny'] as string[] | undefined,
        securityOnly: Boolean(options['securityOnly']),
      });
    default: {
      const _exhaustive: never = cfg.type;
      throw new Error(`Unknown connector type: ${_exhaustive}`);
    }
  }
}

function sourceUrlFor(cfg: ConnectorConfig, current: RawSource): string | undefined {
  if (cfg.type === 'openapi-diff') return String(cfg.options['specUrl'] ?? '');
  if (cfg.type === 'doc-scrape') {
    const urls = cfg.options['urls'] as string[] | undefined;
    return urls?.[0];
  }
  if (cfg.type === 'package-diff') {
    const pkg = String(cfg.options['package'] ?? '');
    const version = current.metadata?.['version'];
    return `https://www.npmjs.com/package/${pkg}${version ? `/v/${version}` : ''}`;
  }
  if (cfg.type === 'dependency-update') {
    return 'https://www.npmjs.com/';
  }
  return undefined;
}

/**
 * Full pipeline:
 * fetch → hash check → diff → classify → scan → fix → validate → PR/Issue → update snapshot
 */
export async function runScan(options: ScanOptions): Promise<void> {
  ensureScannersRegistered();
  const config = loadConfig(options.cwd);

  let provider: ModelProvider | undefined;
  try {
    provider = createModelProvider({ config: config.model });
  } catch (err) {
    if (err instanceof MissingModelKeyError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  console.log(
    `Model: ${config.model.provider} (${config.model.model}) via $${config.model.api_key_env}`,
  );

  const store = new SqliteSnapshotStore(resolve(options.cwd, config.snapshot_db));
  const connectors = activeConnectors(config);
  const scanners = resolveScannersForRepo(options.cwd, config.languages);

  console.log(
    `Patch scan — ${connectors.length} connector(s), languages: ${
      scanners.map((s) => s.language).join(', ') || 'none detected'
    }`,
  );

  try {
    for (const cfg of connectors) {
      console.log(`\n▸ ${cfg.id} (${cfg.type})`);
      const connector = buildConnector(cfg, options.cwd);

      let current: RawSource;
      try {
        current = await connector.fetchRaw();
      } catch (err) {
        console.error(`  fetch failed: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      const previousSnap = store.get(cfg.id);
      const previous: RawSource | null = previousSnap
        ? {
            connector_id: previousSnap.connector_id,
            content_hash: previousSnap.content_hash,
            content: previousSnap.raw_content,
            fetched_at: previousSnap.fetched_at,
          }
        : null;

      if (previous && previous.content_hash === current.content_hash) {
        console.log('  unchanged (content hash match) — skipping');
        store.put({
          connector_id: cfg.id,
          content_hash: current.content_hash,
          raw_content: current.content,
          fetched_at: current.fetched_at,
        });
        continue;
      }

      const rawChanges = await connector.diff(previous, current);
      console.log(`  ${rawChanges.length} raw change(s)`);

      // Always update snapshot so low-confidence Issues aren't re-detected
      store.put({
        connector_id: cfg.id,
        content_hash: current.content_hash,
        raw_content: current.content,
        fetched_at: current.fetched_at,
      });

      if (rawChanges.length === 0) {
        console.log('  no actionable diff');
        continue;
      }

      const classified = await classifyChanges(rawChanges, {
        connectorId: cfg.id,
        importPath: cfg.import_path,
        provider,
      });

      if (classified.needsManualReview.length > 0) {
        console.log(
          `  ${classified.needsManualReview.length} change(s) flagged for manual review`,
        );
      }

      console.log(
        `  classified ${classified.events.length} event(s), ${classified.instructions.length} fix instruction(s)`,
      );

      for (let i = 0; i < classified.events.length; i++) {
        const event = classified.events[i]!;
        const instruction = classified.instructions[i]!;

        const { sites } = scanWithLanguages(
          instruction,
          options.cwd,
          config.languages,
        );
        console.log(`  ${event.surface.path}: ${sites.length} match site(s)`);

        if (sites.length === 0) {
          const report = writeLocalReport(options.cwd, event, []);
          console.log(`  no call sites — wrote diagnosis ${report}`);
          continue;
        }

        const validated = [];
        const rules = loadRules(
          options.cwd,
          config.rules,
          config.disable_default_rules,
        );
        for (const site of sites) {
          const result = await generateAndValidateFix(event, instruction, site, {
            repoRoot: options.cwd,
            rules,
            maxAttempts: config.max_fix_attempts,
            provider,
          });
          validated.push(result);
          const obs = result.observability;
          console.log(
            `    ${site.file}:${site.line} confidence=${(result.confidence * 100).toFixed(0)}%` +
              ` check=${result.typecheckPassed} tests=${result.testsPassed}` +
              ` attempts=${obs.attempts}` +
              (obs.passedOnAttempt ? ` passedOn=${obs.passedOnAttempt}` : ' failed-all') +
              ` fileReads=${obs.totalFileReads}` +
              (site.language ? ` [${site.language}]` : ''),
          );
          if (obs.fileReadPaths.length > 0) {
            console.log(`      reads: ${obs.fileReadPaths.join(', ')}`);
          }
        }

        if (options.dryRun) {
          const report = writeLocalReport(options.cwd, event, validated);
          console.log(`  dry-run report: ${report}`);
          continue;
        }

        const slug = resolveRepoSlug(options.cwd);
        if (!slug) {
          const report = writeLocalReport(options.cwd, event, validated);
          console.log(`  no git remote / GITHUB_REPOSITORY — local report: ${report}`);
          continue;
        }

        const auth = await resolveGithubAuth(slug);
        if (!auth) {
          const report = writeLocalReport(options.cwd, event, validated);
          console.log(`  ${describeMissingGithubAuth()} — local report: ${report}`);
          continue;
        }

        console.log(`  github auth: ${auth.source}`);

        const published = await publishResults({
          event,
          results: validated,
          store,
          repoRoot: options.cwd,
          headBranch: validated[0]?.branchName,
          config: {
            token: auth.token,
            owner: slug.owner,
            repo: slug.repo,
            confidenceThreshold: config.confidence_threshold,
            sourceUrl: sourceUrlFor(cfg, current),
          },
        });

        console.log(
          `  published ${published.kind}${published.url ? `: ${published.url}` : published.reason ? ` (${published.reason})` : ''}`,
        );
      }
    }
  } finally {
    store.close();
  }

  console.log('\nDone.');
}
