import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForMatches, KNOWN_LIMITATIONS } from '../index.js';
import type { FixInstruction } from '@patch-dev/core';

describe('scanner-ts', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function setupRepo(files: Record<string, string>) {
    dir = mkdtempSync(join(tmpdir(), 'patch-scan-'));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
        },
        include: ['src/**/*'],
      }),
    );
    mkdirSync(join(dir, 'src'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    return dir;
  }

  it('documents dynamic import limitation', () => {
    expect(KNOWN_LIMITATIONS.some((l) => l.includes('Dynamic import'))).toBe(true);
  });

  it('finds createCharge call sites across import styles', () => {
    const root = setupRepo({
      'src/default.ts': `
import Client from 'fake-sdk';
export function a() {
  const client = new Client('k');
  return client.createCharge({ amount: 1 });
}
`,
      'src/named.ts': `
import { createClient } from 'fake-sdk';
export function b() {
  const client = createClient('k');
  return client.createCharge({ amount: 1 });
}
`,
      'src/ns.ts': `
import * as Sdk from 'fake-sdk';
export function c() {
  const client = Sdk.createClient('k');
  return client.createCharge({ amount: 1 });
}
`,
      'src/chained.ts': `
import { createClient } from 'fake-sdk';
export const d = () => createClient('k').createCharge({ amount: 1 });
`,
    });

    const instruction: FixInstruction = {
      change_event_id: '550e8400-e29b-41d4-a716-446655440000',
      match_pattern: { import_path: 'fake-sdk', symbol: 'createCharge' },
      transform: { kind: 'change_param', instructions: 'add currency' },
    };

    const sites = scanForMatches(instruction, { repoRoot: root });
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(sites.every((s) => s.snippet.length > 0)).toBe(true);
  });
});
