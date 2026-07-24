import { describe, expect, it } from 'vitest';
import {
  classifyUpdate,
  coerceVersion,
  compareVersions,
  pickTargetVersion,
} from '../semver.js';
import { createDependencyUpdateConnector } from '../index.js';

describe('semver helpers', () => {
  it('coerces caret ranges', () => {
    expect(coerceVersion('^1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: '',
    });
  });

  it('classifies major/minor/patch', () => {
    expect(classifyUpdate('1.0.0', '1.0.1')).toBe('patch');
    expect(classifyUpdate('1.0.0', '1.1.0')).toBe('minor');
    expect(classifyUpdate('1.0.0', '2.0.0')).toBe('major');
    expect(classifyUpdate('1.2.3', '1.2.3')).toBe('none');
  });

  it('picks nearest allowed target', () => {
    expect(
      pickTargetVersion('1.0.0', '2.0.0', ['patch', 'minor'], [
        '2.0.0',
        '1.5.0',
        '1.0.1',
      ]),
    ).toBe('1.5.0');
  });

  it('compares versions', () => {
    expect(
      compareVersions(coerceVersion('1.0.0')!, coerceVersion('1.0.1')!),
    ).toBeLessThan(0);
  });
});

describe('dependency-update connector', () => {
  it('emits dependency_outdated on first scan when updates exist', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('osv.dev')) {
        return new Response(JSON.stringify({ vulns: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          'dist-tags': { latest: '1.2.0' },
          versions: { '1.0.0': {}, '1.1.0': {}, '1.2.0': {} },
        }),
        { status: 200 },
      );
    };

    const connector = createDependencyUpdateConnector('deps', {
      repoRoot: process.cwd(),
      fetchImpl,
      updateTypes: ['patch', 'minor', 'major'],
      allow: ['left-pad'],
    });

    // Use a fake by monkeypatching read — instead write via options and
    // temporary package.json is heavy; unit-test diff mapping with fetch mock
    // against this repo's package.json if left-pad absent → empty.
    // Directly exercise toRawChange path via diff with synthetic sources:
    const current = {
      connector_id: 'deps',
      content_hash: 'abc',
      content: JSON.stringify({
        packages: [
          {
            name: 'left-pad',
            section: 'dependencies',
            range: '^1.0.0',
            current: '1.0.0',
            latest: '1.2.0',
            target: '^1.2.0',
            updateKind: 'minor',
            security: false,
            advisoryIds: [],
          },
        ],
      }),
      fetched_at: new Date().toISOString(),
    };

    const changes = await connector.diff(null, current);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('dependency_outdated');
    expect(changes[0]?.path).toBe('dependencies.left-pad');
  });

  it('emits security_advisory when flagged', async () => {
    const connector = createDependencyUpdateConnector('deps', {
      repoRoot: process.cwd(),
    });
    const current = {
      connector_id: 'deps',
      content_hash: 'abc',
      content: JSON.stringify({
        packages: [
          {
            name: 'lodash',
            section: 'dependencies',
            range: '4.17.20',
            current: '4.17.20',
            latest: '4.17.21',
            target: '4.17.21',
            updateKind: 'patch',
            security: true,
            advisoryIds: ['GHSA-test'],
            advisorySummary: 'Prototype pollution',
          },
        ],
      }),
      fetched_at: new Date().toISOString(),
    };
    const changes = await connector.diff(null, current);
    expect(changes[0]?.kind).toBe('security_advisory');
  });
});
