import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSnapshotStore, contentHash } from '../snapshot-store.js';
import { ChangeEventSchema } from '../schemas.js';
import { PatchConfigSchema as ConfigSchema } from '../config.js';

describe('contentHash', () => {
  it('is stable for the same input', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
  });

  it('differs for different inputs', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

describe('SqliteSnapshotStore', () => {
  let dir: string;
  let store: SqliteSnapshotStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-snap-'));
    store = new SqliteSnapshotStore(join(dir, 'snapshots.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for missing connector', () => {
    expect(store.get('missing')).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const snap = {
      connector_id: 'stripe-openapi',
      content_hash: contentHash('{}'),
      raw_content: '{}',
      fetched_at: new Date().toISOString(),
    };
    store.put(snap);
    expect(store.get('stripe-openapi')).toEqual(snap);
  });

  it('updates on conflict', () => {
    store.put({
      connector_id: 'x',
      content_hash: 'aaa',
      raw_content: 'old',
      fetched_at: '2020-01-01T00:00:00.000Z',
    });
    store.put({
      connector_id: 'x',
      content_hash: 'bbb',
      raw_content: 'new',
      fetched_at: '2021-01-01T00:00:00.000Z',
    });
    expect(store.get('x')?.content_hash).toBe('bbb');
  });

  it('dedups change event links', () => {
    store.putChangeEventLink('evt-1', 'https://github.com/o/r/pull/1', 'pr');
    expect(store.getChangeEventLink('evt-1')?.kind).toBe('pr');
    store.putChangeEventLink('evt-1', 'https://github.com/o/r/issues/2', 'issue');
    expect(store.getChangeEventLink('evt-1')?.github_url).toContain('/pull/1');
  });
});

describe('ChangeEventSchema', () => {
  it('accepts a valid event', () => {
    const result = ChangeEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      connector_id: 'openai-node-sdk',
      detected_at: '2024-01-01T00:00:00.000Z',
      type: 'renamed',
      surface: { kind: 'method', path: 'openai.chat.completions.create' },
      old: { signature: 'create(opts)', description: 'old' },
      new: { signature: 'createChat(opts)', description: 'new' },
      source_excerpt: 'renamed create → createChat',
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid confidence', () => {
    const result = ChangeEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      connector_id: 'x',
      detected_at: '2024-01-01T00:00:00.000Z',
      type: 'removed',
      surface: { kind: 'method', path: 'x' },
      old: { signature: 'a' },
      new: { signature: '' },
      source_excerpt: '',
      confidence: 2,
    });
    expect(result.success).toBe(false);
  });
});

describe('PatchConfigSchema', () => {
  it('applies defaults', () => {
    const cfg = ConfigSchema.parse({
      connectors: [
        {
          id: 'stripe-openapi',
          type: 'openapi-diff',
          import_path: 'stripe',
          options: { specUrl: 'https://example.com/spec.json' },
        },
      ],
    });
    expect(cfg.confidence_threshold).toBe(0.7);
    expect(cfg.version).toBe(1);
  });

  it('accepts languages list', () => {
    const cfg = ConfigSchema.parse({
      languages: ['typescript', 'python'],
      connectors: [
        {
          id: 'x',
          type: 'package-diff',
          import_path: 'openai',
          options: {},
        },
      ],
    });
    expect(cfg.languages).toEqual(['typescript', 'python']);
  });
});
