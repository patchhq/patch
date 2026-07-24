import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PatchConfigSchema } from '@patch-dev/core';
import { assertNoEmbeddedSecrets } from '@patch-dev/model';

/** Key-shaped strings that must never appear in committed config/examples. */
const KEY_SHAPED =
  /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY/;

describe('patch.config.json never stores API keys', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('parsed model section has provider + env name only', () => {
    const parsed = PatchConfigSchema.parse({
      connectors: [
        {
          id: 'x',
          type: 'openapi-diff',
          import_path: 'stripe',
          options: {},
        },
      ],
      model: { provider: 'openai', api_key_env: 'OPENAI_API_KEY' },
    });
    const json = JSON.stringify(parsed.model);
    expect(json).toContain('OPENAI_API_KEY');
    expect(json).not.toMatch(KEY_SHAPED);
    expect(() => assertNoEmbeddedSecrets(parsed.model)).not.toThrow();
  });

  it('rejects writing a config blob that embeds a key', () => {
    const bad = {
      version: 1,
      connectors: [
        {
          id: 'x',
          type: 'openapi-diff',
          import_path: 'stripe',
          options: {},
        },
      ],
      model: {
        provider: 'anthropic',
        api_key_env: 'ANTHROPIC_API_KEY',
        api_key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      },
    };
    expect(() => assertNoEmbeddedSecrets(bad)).toThrow(/Refusing/);
  });

  it('disk config round-trip never contains key-shaped strings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-cfg-'));
    dirs.push(dir);
    const path = join(dir, 'patch.config.json');
    const onDisk = {
      version: 1,
      confidence_threshold: 0.7,
      snapshot_db: '.patch/snapshots.db',
      languages: ['typescript'],
      max_fix_attempts: 3,
      model: {
        provider: 'anthropic',
        api_key_env: 'ANTHROPIC_API_KEY',
        model: 'claude-sonnet-4-20250514',
      },
      connectors: [
        {
          id: 'example',
          type: 'openapi-diff',
          enabled: false,
          import_path: 'stripe',
          options: { specUrl: 'https://example.com/openapi.json' },
        },
      ],
    };
    writeFileSync(path, `${JSON.stringify(onDisk, null, 2)}\n`);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toMatch(KEY_SHAPED);
    const parsed = PatchConfigSchema.parse(JSON.parse(raw));
    expect(parsed.model.api_key_env).toBe('ANTHROPIC_API_KEY');
    expect(JSON.stringify(parsed)).not.toMatch(KEY_SHAPED);
  });
});
