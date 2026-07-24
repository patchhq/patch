import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeOpenApi, diffNormalized, OpenApiDiffConnector } from '../index.js';
import { contentHash } from '@patch-dev/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
}

describe('OpenAPI structural diff', () => {
  it('detects added path, added required param, and response schema change', () => {
    const before = normalizeOpenApi(loadFixture('before.json'));
    const after = normalizeOpenApi(loadFixture('after.json'));
    const changes = diffNormalized(before, after);

    const kinds = changes.map((c) => c.kind);
    expect(kinds).toContain('path_added');
    expect(kinds).toContain('param_changed');
    expect(kinds).toContain('response_schema_changed');

    expect(changes.some((c) => c.path.includes('/v1/refund'))).toBe(true);
    expect(changes.some((c) => c.path.includes('currency'))).toBe(true);
  });

  it('returns empty when specs are identical', () => {
    const n = normalizeOpenApi(loadFixture('before.json'));
    expect(diffNormalized(n, n)).toEqual([]);
  });

  it('short-circuits on matching content hash', async () => {
    const content = JSON.stringify(loadFixture('before.json'));
    const connector = new OpenApiDiffConnector('test', {
      specUrl: 'https://example.com/spec.json',
      fetchImpl: async () =>
        new Response(content, { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const current = await connector.fetchRaw();
    const previous = {
      ...current,
      content_hash: contentHash(content),
    };
    expect(connector.diff(previous, current)).toEqual([]);
  });
});
