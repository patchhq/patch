import { z } from 'zod';

/** Surface of an API that changed (method, endpoint, field, or type). */
export const SurfaceSchema = z.object({
  kind: z.enum(['method', 'endpoint', 'field', 'type']),
  path: z.string().min(1),
});
export type Surface = z.infer<typeof SurfaceSchema>;

export const SignatureBlockSchema = z.object({
  signature: z.string(),
  description: z.string().optional(),
});
export type SignatureBlock = z.infer<typeof SignatureBlockSchema>;

/**
 * Output of the Classify stage — a structured interpretation of a RawChange.
 */
export const ChangeEventSchema = z.object({
  id: z.string().uuid(),
  connector_id: z.string().min(1),
  detected_at: z.string().datetime(),
  type: z.enum([
    'renamed',
    'removed',
    'added_required_param',
    'type_changed',
    'deprecated',
    'behavior_changed',
  ]),
  surface: SurfaceSchema,
  old: SignatureBlockSchema,
  new: SignatureBlockSchema,
  source_excerpt: z.string(),
  confidence: z.number().min(0).max(1),
  needs_manual_review: z.boolean().optional(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

export const MatchPatternSchema = z.object({
  /**
   * Module specifier — language-agnostic.
   * Examples: npm `openai`, Python `openai`, Rust `openai_api`, Go `github.com/sashabaranov/go-openai`.
   * Field name is historical (TS-first MVP); do not treat it as JS-only.
   */
  import_path: z.string().min(1),
  /** Nested symbol path, e.g. `chat.completions.create` or `Client.create_charge`. */
  symbol: z.string().min(1),
  /**
   * Optional language hint. When set, only scanners for that language use this pattern.
   * When omitted, every active language scanner may attempt a match.
   */
  language: z.enum(['typescript', 'javascript', 'python', 'rust', 'go']).optional(),
});
export type MatchPattern = z.infer<typeof MatchPatternSchema>;

export const TransformSchema = z.object({
  kind: z.enum(['rename_method', 'change_param', 'wrap_call', 'remove_call']),
  instructions: z.string().min(1),
});
export type Transform = z.infer<typeof TransformSchema>;

/**
 * Bridges a ChangeEvent to a codemod the scanner + fix generator can apply.
 */
export const FixInstructionSchema = z.object({
  change_event_id: z.string().uuid(),
  match_pattern: MatchPatternSchema,
  transform: TransformSchema,
});
export type FixInstruction = z.infer<typeof FixInstructionSchema>;

/** A single call site found by a language scanner. */
export const MatchSiteSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  snippet: z.string(),
  /** Which scanner produced this site — used for language-specific validation. */
  language: z.enum(['typescript', 'javascript', 'python', 'rust', 'go']).optional(),
});
export type MatchSite = z.infer<typeof MatchSiteSchema>;

/**
 * Per-connector stored state used to short-circuit unchanged sources.
 */
export const SnapshotSchema = z.object({
  connector_id: z.string().min(1),
  content_hash: z.string().min(1),
  raw_content: z.string(),
  fetched_at: z.string().datetime(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * What the PR bot receives — one per MatchSite after fix generation + validation.
 */
export const PatchResultSchema = z.object({
  match_site: MatchSiteSchema,
  patch: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  change_event_id: z.string().uuid().optional(),
});
export type PatchResult = z.infer<typeof PatchResultSchema>;

/** Raw upstream payload returned by a connector's fetchRaw(). */
export const RawSourceSchema = z.object({
  connector_id: z.string(),
  content_hash: z.string(),
  content: z.string(),
  fetched_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});
export type RawSource = z.infer<typeof RawSourceSchema>;

/**
 * Structural or textual delta before LLM classification.
 * Connectors emit these; Classify turns them into ChangeEvents.
 */
export const RawChangeSchema = z.object({
  kind: z.string().min(1),
  path: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  excerpt: z.string().optional(),
  structural_confidence: z.enum(['high', 'low']).default('high'),
});
export type RawChange = z.infer<typeof RawChangeSchema>;
