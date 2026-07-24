import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ChangeEventSchema,
  FixInstructionSchema,
  type ChangeEvent,
  type FixInstruction,
  type RawChange,
} from '@patch-dev/core';
import type { ModelProvider } from '@patch-dev/model';

export interface ClassifyOptions {
  connectorId: string;
  /** Default import path for FixInstruction mapping. */
  importPath: string;
  /**
   * When set, use this provider for LLM classification.
   * When omitted, falls back to deterministic heuristics (unit tests / offline).
   */
  provider?: ModelProvider;
}

export interface ClassifyResult {
  events: ChangeEvent[];
  instructions: FixInstruction[];
  needsManualReview: RawChange[];
}

const ClassifiedItemSchema = z.object({
  change_event: ChangeEventSchema.omit({ id: true, connector_id: true, detected_at: true }).extend({
    id: z.string().uuid().optional(),
    connector_id: z.string().optional(),
    detected_at: z.string().optional(),
  }),
  fix_instruction: FixInstructionSchema.omit({ change_event_id: true }).extend({
    change_event_id: z.string().uuid().optional(),
  }),
});

const ClassifyBatchSchema = z.object({
  items: z.array(ClassifiedItemSchema),
  skipped: z
    .array(
      z.object({
        raw_change_path: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
});

const SYSTEM_PROMPT = `You are Patch's change classifier. You receive a batch of RawChange objects from an API connector (OpenAPI diff, doc scrape, or package type diff).

For each change that is a real breaking or behavior-affecting change for TypeScript/JavaScript consumers, emit:
1. A ChangeEvent (type, surface, old/new signatures, source_excerpt, confidence 0-1 where confidence = "is this actually breaking")
2. A FixInstruction with match_pattern (import_path + symbol path) and transform (kind + instructions)

Skip cosmetic/docs-only noise. Prefer fewer high-quality items over many weak ones.
Respond with JSON matching the schema exactly.`;

function buildUserPrompt(
  connectorId: string,
  importPath: string,
  changes: RawChange[],
  validationError?: string,
): string {
  let prompt = `Connector: ${connectorId}
Default import_path for FixInstruction.match_pattern: ${importPath}

RawChanges (JSON):
${JSON.stringify(changes, null, 2)}

Respond with JSON:
{
  "items": [
    {
      "change_event": {
        "type": "renamed|removed|added_required_param|type_changed|deprecated|behavior_changed",
        "surface": { "kind": "method|endpoint|field|type", "path": "..." },
        "old": { "signature": "...", "description": "..." },
        "new": { "signature": "...", "description": "..." },
        "source_excerpt": "...",
        "confidence": 0.0
      },
      "fix_instruction": {
        "match_pattern": { "import_path": "${importPath}", "symbol": "..." },
        "transform": { "kind": "rename_method|change_param|wrap_call|remove_call", "instructions": "..." }
      }
    }
  ],
  "skipped": [{ "raw_change_path": "...", "reason": "..." }]
}`;

  if (validationError) {
    prompt += `\n\nPrevious response failed validation. Fix these errors:\n${validationError}`;
  }
  return prompt;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response');
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

/**
 * Classify a batch of RawChanges into ChangeEvents + FixInstructions.
 * On Zod failure, retries once with the validation error appended.
 * Second failure → raw changes flagged needs_manual_review (not dropped).
 */
export async function classifyChanges(
  changes: RawChange[],
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  if (changes.length === 0) {
    return { events: [], instructions: [], needsManualReview: [] };
  }

  if (!options.provider) {
    return heuristicClassify(changes, options);
  }

  const provider = options.provider;

  let validationError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.complete({
      system: SYSTEM_PROMPT,
      maxTokens: 4096,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(
            options.connectorId,
            options.importPath,
            changes,
            validationError,
          ),
        },
      ],
    });

    try {
      const parsed = ClassifyBatchSchema.parse(extractJson(result.content));
      const events: ChangeEvent[] = [];
      const instructions: FixInstruction[] = [];
      const now = new Date().toISOString();

      for (const item of parsed.items) {
        const id = item.change_event.id ?? randomUUID();
        const event = ChangeEventSchema.parse({
          ...item.change_event,
          id,
          connector_id: options.connectorId,
          detected_at: now,
        });
        const instruction = FixInstructionSchema.parse({
          ...item.fix_instruction,
          change_event_id: id,
          match_pattern: {
            ...item.fix_instruction.match_pattern,
            import_path:
              item.fix_instruction.match_pattern.import_path || options.importPath,
          },
        });
        events.push(event);
        instructions.push(instruction);
      }

      return { events, instructions, needsManualReview: [] };
    } catch (err) {
      validationError = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        return {
          events: [],
          instructions: [],
          needsManualReview: changes.map((c) => ({
            ...c,
            excerpt: `${c.excerpt ?? ''}\n[needs_manual_review] ${validationError}`,
          })),
        };
      }
    }
  }

  return { events: [], instructions: [], needsManualReview: changes };
}

/**
 * Offline heuristic classifier for CI / no-provider runs.
 * Maps obvious structural kinds into ChangeEvents without an LLM.
 */
export function heuristicClassify(
  changes: RawChange[],
  options: ClassifyOptions,
): ClassifyResult {
  const events: ChangeEvent[] = [];
  const instructions: FixInstruction[] = [];
  const needsManualReview: RawChange[] = [];
  const now = new Date().toISOString();
  /** Dedupe Options-type property churn into one call-site instruction. */
  const seenSymbols = new Set<string>();

  for (const change of changes) {
    // Docs/version noise — not a call-site fix target
    if (change.kind === 'changelog_updated' || change.kind === 'version_bump') {
      continue;
    }

    const id = randomUUID();
    let type: ChangeEvent['type'] = 'behavior_changed';
    let transformKind: FixInstruction['transform']['kind'] = 'change_param';

    switch (change.kind) {
      case 'path_removed':
      case 'export_removed':
      case 'section_removed':
        type = 'removed';
        transformKind = 'remove_call';
        break;
      case 'param_changed':
      case 'required_flag_changed':
        type = 'added_required_param';
        transformKind = 'change_param';
        break;
      case 'signature_changed':
      case 'response_schema_changed':
        type = 'type_changed';
        transformKind = 'change_param';
        break;
      case 'export_added':
      case 'path_added':
      case 'section_added':
        if (change.structural_confidence === 'low') {
          needsManualReview.push(change);
          continue;
        }
        type = 'behavior_changed';
        break;
      case 'section_changed':
        needsManualReview.push(change);
        continue;
      default:
        break;
    }

    const symbol = matchSymbolFromChangePath(change.path);
    if (seenSymbols.has(symbol)) {
      continue;
    }
    seenSymbols.add(symbol);

    const confidence =
      change.structural_confidence === 'high' ? 0.75 : 0.4;

    const event: ChangeEvent = {
      id,
      connector_id: options.connectorId,
      detected_at: now,
      type,
      surface: {
        kind: change.kind.includes('path') ? 'endpoint' : 'method',
        path: change.path,
      },
      old: {
        signature: JSON.stringify(change.before ?? null),
        description: change.kind,
      },
      new: {
        signature: JSON.stringify(change.after ?? null),
        description: change.kind,
      },
      source_excerpt: change.excerpt ?? change.kind,
      confidence,
    };

    const instruction: FixInstruction = {
      change_event_id: id,
      match_pattern: {
        import_path: options.importPath,
        symbol,
      },
      transform: {
        kind: transformKind,
        instructions: `Apply fix for ${change.kind} at ${change.path}: ${change.excerpt ?? ''}`,
      },
    };

    events.push(event);
    instructions.push(instruction);
  }

  return { events, instructions, needsManualReview };
}

const OPTIONS_SUFFIX = /(Options|Params|Config|Request|Args|Input)$/;

/**
 * Map package-diff declaration paths to call-site symbols the scanner can find.
 * e.g. ChargeOptions / ChargeOptions.currency → createCharge
 *      FakeApiClient.createCharge → createCharge
 */
export function matchSymbolFromChangePath(path: string): string {
  const cleaned = path.replace(/\?+$/g, '');
  const parts = cleaned.split('.').filter(Boolean);
  const root = parts[0] ?? cleaned;
  const leaf = parts[parts.length - 1] ?? cleaned;

  if (OPTIONS_SUFFIX.test(root)) {
    const stem = root.replace(OPTIONS_SUFFIX, '');
    return stem ? `create${stem}` : leaf;
  }

  // Class.method or interface.method → method
  if (parts.length >= 2 && /^[A-Z]/.test(root) && /^[a-zA-Z_]/.test(leaf)) {
    return leaf;
  }

  return leaf || cleaned;
}
