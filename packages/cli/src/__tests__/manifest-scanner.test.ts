import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanPackageJsonManifest } from '../manifest-scanner.js';
import type { FixInstruction } from '@patch-dev/core';

describe('scanPackageJsonManifest', () => {
  it('finds a dependency line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-manifest-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        `${JSON.stringify(
          {
            name: 'app',
            dependencies: {
              lodash: '^4.17.20',
              zod: '^3.0.0',
            },
          },
          null,
          2,
        )}\n`,
      );
      const instruction: FixInstruction = {
        change_event_id: '550e8400-e29b-41d4-a716-446655440000',
        match_pattern: { import_path: 'lodash', symbol: 'dependencies' },
        transform: {
          kind: 'bump_dependency',
          instructions: 'Bump lodash to ^4.17.21',
        },
      };
      const sites = scanPackageJsonManifest(instruction, dir);
      expect(sites).toHaveLength(1);
      expect(sites[0]?.file).toBe('package.json');
      expect(sites[0]?.snippet).toContain('lodash');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
