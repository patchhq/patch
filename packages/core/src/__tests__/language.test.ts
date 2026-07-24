import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectLanguages,
  registerScanner,
  resolveScannersForRepo,
  listRegisteredScanners,
  type LanguageScanner,
  type FixInstruction,
} from '../index.js';

describe('detectLanguages', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-lang-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects typescript from tsconfig', () => {
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    expect(detectLanguages(dir)).toContain('typescript');
  });

  it('detects python, rust, and go markers', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname="x"\n');
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\n');
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n');
    const langs = detectLanguages(dir);
    expect(langs).toEqual(expect.arrayContaining(['python', 'rust', 'go']));
  });
});

describe('scanner registry', () => {
  const stub = (language: LanguageScanner['language']): LanguageScanner => ({
    language,
    name: language,
    extensions: [],
    limitations: [],
    detects: () => language === 'typescript',
    scan: (_i: FixInstruction) => [],
  });

  beforeEach(() => {
    // Clear by re-registering over the map — registry is module-level.
    // Tests only need resolve behavior with freshly registered stubs.
    for (const existing of listRegisteredScanners()) {
      // no unregister API — overwrite via register
      void existing;
    }
    registerScanner(stub('typescript'));
    registerScanner(stub('python'));
  });

  it('resolves detected scanners', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-reg-'));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    const scanners = resolveScannersForRepo(dir);
    expect(scanners.map((s) => s.language)).toContain('typescript');
    rmSync(dir, { recursive: true, force: true });
  });

  it('filters by configured languages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-reg-'));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'pyproject.toml'), '');
    // python stub detects() returns false — force via config fallback
    const scanners = resolveScannersForRepo(dir, ['python']);
    expect(scanners.every((s) => s.language === 'python')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
