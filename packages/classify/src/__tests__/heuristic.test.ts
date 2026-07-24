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
});
