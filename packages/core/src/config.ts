import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PatchRuleSchema } from './rules.js';

export const LanguageConfigSchema = z.enum([
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
]);

export const ConnectorConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['openapi-diff', 'doc-scrape', 'package-diff']),
  enabled: z.boolean().default(true),
  /** Module specifier for FixInstruction.match_pattern.import_path (any language). */
  import_path: z.string().min(1),
  options: z.record(z.unknown()).default({}),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export const PatchConfigSchema = z.object({
  version: z.literal(1).default(1),
  confidence_threshold: z.number().min(0).max(1).default(0.7),
  snapshot_db: z.string().default('.patch/snapshots.db'),
  /**
   * Languages to scan. When omitted, Patch auto-detects from marker files
   * (tsconfig.json, pyproject.toml, Cargo.toml, go.mod, …).
   */
  languages: z.array(LanguageConfigSchema).optional(),
  /**
   * User fix-agent rules (merged with defaults). Same `id` overrides a default.
   * Free-form extras can also live in `.patch/rules.md`.
   */
  rules: z.array(PatchRuleSchema).optional(),
  /** Default rule ids to disable (e.g. `["minimal-diff"]`). */
  disable_default_rules: z.array(z.string()).optional(),
  /** Max fix attempts in the agentic validation loop (default 3). */
  max_fix_attempts: z.number().int().min(1).max(5).default(3),
  connectors: z.array(ConnectorConfigSchema).min(1),
});
export type PatchConfig = z.infer<typeof PatchConfigSchema>;

export function loadConfig(cwd: string = process.cwd()): PatchConfig {
  const path = resolve(cwd, 'patch.config.json');
  if (!existsSync(path)) {
    throw new Error(
      `No patch.config.json found in ${cwd}. Run \`npx -y @patch-dev/cli init\` first.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return PatchConfigSchema.parse(raw);
}

export function activeConnectors(config: PatchConfig): ConnectorConfig[] {
  return config.connectors.filter((c) => c.enabled);
}
