import { describe, it, expect } from 'vitest';
import { heuristicClassify, matchSymbolFromChangePath } from '../index.js';
import type { RawChange } from '@patch-dev/core';

describe('matchSymbolFromChangePath', () => {
  it('maps Options types to create* call sites', () => {
    expect(matchSymbolFromChangePath('ChargeOptions')).toBe('createCharge');
    expect(matchSymbolFromChangePath('ChargeOptions.currency')).toBe('createCharge');
    expect(matchSymbolFromChangePath('ChargeOptions.currency?')).toBe('createCharge');
  });

  it('uses method leaf for Class.method paths', () => {
    expect(matchSymbolFromChangePath('FakeApiClient.createCharge')).toBe(
      'createCharge',
    );
  });
});

describe('heuristicClassify', () => {
  it('emits one createCharge instruction for Options required-flag churn', () => {
    const changes: RawChange[] = [
      {
        kind: 'signature_changed',
        path: 'ChargeOptions',
        before: { name: 'ChargeOptions', kind: 'interface', signature: 'currency?: string' },
        after: { name: 'ChargeOptions', kind: 'interface', signature: 'currency: string' },
        structural_confidence: 'high',
      },
      {
        kind: 'required_flag_changed',
        path: 'ChargeOptions.currency',
        before: { name: 'ChargeOptions.currency?', kind: 'property', signature: 'currency?: string' },
        after: { name: 'ChargeOptions.currency', kind: 'property', signature: 'currency: string' },
        structural_confidence: 'high',
      },
      {
        kind: 'export_removed',
        path: 'ChargeOptions.currency?',
        before: { name: 'ChargeOptions.currency?', kind: 'property', signature: 'currency?: string' },
        structural_confidence: 'high',
      },
      {
        kind: 'changelog_updated',
        path: 'CHANGELOG.md',
        structural_confidence: 'low',
      },
    ];

    const result = heuristicClassify(changes, {
      connectorId: 'fixture',
      importPath: '@fixture/fake-api-client',
    });

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]?.match_pattern.symbol).toBe('createCharge');
    expect(result.events[0]?.type).toBe('type_changed');
  });

  it('maps dependency_outdated to bump_dependency', () => {
    const result = heuristicClassify(
      [
        {
          kind: 'dependency_outdated',
          path: 'dependencies.lodash',
          before: { name: 'lodash', section: 'dependencies', version: '4.17.20' },
          after: {
            name: 'lodash',
            section: 'dependencies',
            range: '^4.17.21',
            version: '4.17.21',
            updateKind: 'patch',
          },
          excerpt: 'Dependency update lodash: 4.17.20 → ^4.17.21 (patch)',
          structural_confidence: 'high',
        },
      ],
      { connectorId: 'npm-dependency-updates', importPath: '*' },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('dependency_update');
    expect(result.instructions[0]?.transform.kind).toBe('bump_dependency');
    expect(result.instructions[0]?.match_pattern.import_path).toBe('lodash');
    expect(result.instructions[0]?.match_pattern.symbol).toBe('dependencies');
  });
});
