import { describe, expect, it } from 'vitest';
import {
  ChangeEventSchema,
  FixInstructionSchema,
  type RawChange,
} from '@patch-dev/core';
import type { ModelCompleteRequest, ModelProvider } from '@patch-dev/model';
import { classifyChanges } from '../index.js';

function mockProvider(
  id: 'anthropic' | 'openai',
  content: string,
): ModelProvider {
  return {
    id,
    model: id === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514',
    async complete(_req: ModelCompleteRequest) {
      return { content, toolCalls: [], raw: { mocked: true } };
    },
  };
}

const SAMPLE_JSON = JSON.stringify({
  items: [
    {
      change_event: {
        type: 'added_required_param',
        surface: { kind: 'field', path: 'ChargeOptions.currency' },
        old: { signature: 'currency?: string' },
        new: { signature: 'currency: string' },
        source_excerpt: 'currency required',
        confidence: 0.9,
      },
      fix_instruction: {
        match_pattern: {
          import_path: '@fixture/fake-api-client',
          symbol: 'createCharge',
        },
        transform: {
          kind: 'change_param',
          instructions: 'Add currency: "usd" to createCharge options',
        },
      },
    },
  ],
  skipped: [],
});

describe('classify via pluggable providers', () => {
  const changes: RawChange[] = [
    {
      kind: 'required_flag_changed',
      path: 'ChargeOptions.currency',
      before: 'optional',
      after: 'required',
      excerpt: 'currency',
      structural_confidence: 'high',
    },
  ];

  it.each(['anthropic', 'openai'] as const)(
    'validates ChangeEvent/FixInstruction for %s-shaped provider',
    async (id) => {
      const result = await classifyChanges(changes, {
        connectorId: 'fixture',
        importPath: '@fixture/fake-api-client',
        provider: mockProvider(id, SAMPLE_JSON),
      });
      expect(result.needsManualReview).toHaveLength(0);
      expect(result.events).toHaveLength(1);
      expect(result.instructions).toHaveLength(1);
      expect(ChangeEventSchema.parse(result.events[0]!)).toBeTruthy();
      expect(FixInstructionSchema.parse(result.instructions[0]!)).toBeTruthy();
    },
  );
});
