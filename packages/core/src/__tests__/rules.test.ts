import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FIX_RULES,
  mergeRules,
  parseRulesMarkdown,
  formatRulesForPrompt,
  loadRules,
} from '../rules.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('rules', () => {
  it('ships default after-fix validation rules', () => {
    const ids = DEFAULT_FIX_RULES.map((r) => r.id);
    expect(ids).toContain('after-fix-typecheck');
    expect(ids).toContain('after-fix-capture-errors');
    expect(ids).toContain('after-fix-run-tests');
    expect(ids).toContain('bounded-retries');
  });

  it('merges user overrides and disables', () => {
    const merged = mergeRules(
      [{ id: 'minimal-diff', text: 'custom minimal', enabled: true }],
      ['bounded-retries'],
    );
    expect(merged.find((r) => r.id === 'bounded-retries')).toBeUndefined();
    expect(merged.find((r) => r.id === 'minimal-diff')?.text).toBe('custom minimal');
  });

  it('parses markdown bullets', () => {
    const rules = parseRulesMarkdown('# Rules\n\n- Prefer named exports\n- Skip generated files\n');
    expect(rules).toHaveLength(2);
    expect(rules[0]!.text).toBe('Prefer named exports');
  });

  it('formats rules for the fix prompt', () => {
    const text = formatRulesForPrompt(DEFAULT_FIX_RULES.slice(0, 2));
    expect(text).toContain('Patch rules');
    expect(text).toContain('after-fix-typecheck');
  });

  it('loads .patch/rules.md extras', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-rules-'));
    mkdirSync(join(dir, '.patch'), { recursive: true });
    writeFileSync(join(dir, '.patch', 'rules.md'), '- Never touch legacy/\n');
    const rules = loadRules(dir);
    expect(rules.some((r) => r.text.includes('Never touch legacy'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
