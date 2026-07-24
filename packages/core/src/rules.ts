import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';

/**
 * A Patch rule shapes fix-agent behavior (prompt + pipeline constraints).
 * Users can add custom rules; defaults always apply unless explicitly disabled.
 */
export const PatchRuleSchema = z.object({
  id: z.string().min(1),
  /** Natural-language instruction injected into the fix-agent prompt. */
  text: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type PatchRule = z.infer<typeof PatchRuleSchema>;

/**
 * Default rules for the agentic fix stage.
 * Encode the post-fix validation loop: build → check errors → tests → revise.
 */
export const DEFAULT_FIX_RULES: PatchRule[] = [
  {
    id: 'after-fix-typecheck',
    text: 'After proposing a patch, apply it and run the project type-check / build (e.g. tsc --noEmit). Prefer a fix that type-checks cleanly.',
    enabled: true,
  },
  {
    id: 'after-fix-capture-errors',
    text: 'If type-check fails, read the exact compiler error output and revise the patch to fix that specific error. Do not ignore or invent errors.',
    enabled: true,
  },
  {
    id: 'after-fix-run-tests',
    text: 'If type-check passes and a test suite exists, run the tests. If tests fail, revise the patch using the exact failure output.',
    enabled: true,
  },
  {
    id: 'bounded-retries',
    text: 'Retry validation-driven revisions at most 3 total attempts. If all attempts fail validation, stop and emit a low-confidence result (Issue path) — do not loop further.',
    enabled: true,
  },
  {
    id: 'minimal-diff',
    text: 'Change only what is required for the upstream API change. Prefer the smallest correct edit over a broad rewrite.',
    enabled: true,
  },
  {
    id: 'read-context-sparingly',
    text: 'You may use read_file to pull surrounding context from the customer repo (max 3 reads per attempt). Prefer reading siblings or helpers over guessing.',
    enabled: true,
  },
];

export const MAX_FIX_ATTEMPTS = 3;
export const MAX_FILE_READS_PER_ATTEMPT = 3;

/** Merge defaults with user rules; user rules with the same id override defaults. */
export function mergeRules(
  userRules: PatchRule[] = [],
  disableDefaultIds: string[] = [],
): PatchRule[] {
  const disabled = new Set(disableDefaultIds);
  const byId = new Map<string, PatchRule>();

  for (const rule of DEFAULT_FIX_RULES) {
    if (!disabled.has(rule.id) && rule.enabled) {
      byId.set(rule.id, rule);
    }
  }
  for (const rule of userRules) {
    if (rule.enabled === false) {
      byId.delete(rule.id);
    } else {
      byId.set(rule.id, { ...rule, enabled: true });
    }
  }

  return [...byId.values()];
}

/**
 * Load rules for a repo:
 * 1. Defaults
 * 2. `patch.config.json` → `rules` / `disable_default_rules`
 * 3. Optional `.patch/rules.md` (free-form bullets appended as custom rules)
 */
export function loadRules(
  cwd: string,
  configRules?: PatchRule[],
  disableDefaultIds?: string[],
): PatchRule[] {
  const merged = mergeRules(configRules ?? [], disableDefaultIds ?? []);

  const mdPath = resolve(cwd, '.patch', 'rules.md');
  if (existsSync(mdPath)) {
    const extras = parseRulesMarkdown(readFileSync(mdPath, 'utf8'));
    return mergeRules([...merged, ...extras], []);
  }

  return merged;
}

/** Parse a simple markdown list of rules into PatchRule objects. */
export function parseRulesMarkdown(markdown: string): PatchRule[] {
  const rules: PatchRule[] = [];
  let idx = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    idx += 1;
    rules.push({
      id: `user-md-${idx}`,
      text: m[1]!.trim(),
      enabled: true,
    });
  }
  return rules;
}

/** Format enabled rules for injection into the fix-agent system/user prompt. */
export function formatRulesForPrompt(rules: PatchRule[]): string {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return '';
  return [
    '## Patch rules (follow these)',
    ...enabled.map((r, i) => `${i + 1}. [${r.id}] ${r.text}`),
  ].join('\n');
}

/** Scaffold default rules file for `patch init`. */
export function defaultRulesMarkdown(): string {
  return [
    '# Patch fix rules',
    '',
    'Add custom bullets below. Defaults from Patch still apply unless disabled in patch.config.json.',
    '',
    ...DEFAULT_FIX_RULES.map((r) => `- ${r.text}`),
    '',
  ].join('\n');
}

export function writeDefaultRulesFile(cwd: string): string {
  const dir = join(cwd, '.patch');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'rules.md');
  if (!existsSync(path)) {
    writeFileSync(path, defaultRulesMarkdown(), 'utf8');
  }
  return path;
}
