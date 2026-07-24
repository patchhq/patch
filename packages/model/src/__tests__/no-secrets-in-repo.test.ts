import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(import.meta.url), '../../../../..');

/** Real key material must never land in committed files. */
const KEY_SHAPED =
  /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY/;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'out',
  'coverage',
]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(json|md|ya?ml|example|ts|mjs|js)$/.test(name)) out.push(full);
  }
}

describe('committed files contain no key-shaped secrets', () => {
  it('scans patch.config.json examples and env templates', () => {
    const files: string[] = [];
    for (const rel of [
      'examples',
      'packages/cli',
      'packages/core',
      'packages/model',
      '.env.example',
      'README.md',
      'docs',
    ]) {
      const full = join(ROOT, rel);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full, files);
        else files.push(full);
      } catch {
        // missing path
      }
    }

    const offenders: string[] = [];
    for (const file of files) {
      // Tests may include example key-shaped strings for rejection assertions.
      if (file.includes(`${'__tests__'}`)) continue;
      const text = readFileSync(file, 'utf8');
      if (KEY_SHAPED.test(text)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
