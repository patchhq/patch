import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MAX_FILE_READS_PER_ATTEMPT,
  MAX_FIX_ATTEMPTS,
  PatchResultSchema,
  formatRulesForPrompt,
  loadRules,
  type ChangeEvent,
  type FixInstruction,
  type MatchSite,
  type PatchResult,
  type PatchRule,
} from '@patch-dev/core';
import type { ModelMessage, ModelProvider } from '@patch-dev/model';
import { validateProject, type ProjectValidation } from './validators.js';
import {
  READ_FILE_TOOL,
  createReadFileState,
  executeReadFile,
  type ReadFileToolState,
} from './read-file-tool.js';

/** Confidence ceilings after validation (attempt count does NOT affect these). */
export const CONFIDENCE_CEILINGS = {
  full: 1.0,
  typecheckOnly: 0.75,
  typecheckFailed: 0.25,
} as const;

const GeneratedFixSchema = z.object({
  before: z.string(),
  after: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type GeneratedFix = z.infer<typeof GeneratedFixSchema>;

export interface FixAttemptRecord {
  attempt: number;
  fileReads: number;
  fileReadPaths: string[];
  validationPassed: boolean;
  failedStage: 'typecheck' | 'test' | null;
  errorOutput: string;
}

/** Observability for cost/latency debugging. */
export interface FixObservability {
  attempts: number;
  totalFileReads: number;
  fileReadPaths: string[];
  passedOnAttempt: number | null;
  attemptLog: FixAttemptRecord[];
}

export interface ValidatedPatch extends PatchResult {
  typecheckPassed: boolean;
  testsPassed: boolean | null;
  branchName: string;
  worktreePath: string;
  observability: FixObservability;
}

export interface ProposeFixContext {
  event: ChangeEvent;
  instruction: FixInstruction;
  site: MatchSite;
  repoRoot: string;
  rules: PatchRule[];
  /** Prior patch + validation error when revising. */
  previous?: {
    patch: GeneratedFix;
    errorOutput: string;
    failedStage: 'typecheck' | 'test';
  };
  /** Mutable read_file budget for this attempt. */
  readState: ReadFileToolState;
  maxFileReads: number;
}

/**
 * Injectable proposer — production uses ModelProvider; tests inject a mock.
 */
export type ProposeFixFn = (ctx: ProposeFixContext) => Promise<GeneratedFix>;

export interface AgenticFixOptions {
  repoRoot: string;
  /** Pluggable LLM used when proposeFix is not injected. */
  provider?: ModelProvider;
  rules?: PatchRule[];
  maxAttempts?: number;
  maxFileReadsPerAttempt?: number;
  /** Override the model call (for tests). */
  proposeFix?: ProposeFixFn;
  worktreeRoot?: string;
  branchPrefix?: string;
  /** Optional logger sink (defaults to console). */
  log?: (message: string, data?: Record<string, unknown>) => void;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response');
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

export function toUnifiedHint(before: string, after: string, file: string): string {
  return `--- a/${file}\n+++ b/${file}\n@@\n- ${before.split('\n').join('\n- ')}\n+ ${after.split('\n').join('\n+ ')}`;
}

export function fromUnifiedHint(patch: string): { before: string; after: string } {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('- ') && !line.startsWith('---')) beforeLines.push(line.slice(2));
    else if (line.startsWith('+ ') && !line.startsWith('+++')) afterLines.push(line.slice(2));
  }
  return { before: beforeLines.join('\n').trim(), after: afterLines.join('\n') };
}

function defaultLog(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[patch:fix] ${message}`, JSON.stringify(data));
  } else {
    console.log(`[patch:fix] ${message}`);
  }
}

function applyConfidenceCeiling(
  modelConfidence: number,
  validation: ProjectValidation,
): number {
  if (!validation.typecheckPassed) {
    return Math.min(modelConfidence, CONFIDENCE_CEILINGS.typecheckFailed);
  }
  if (validation.testsPassed === true) {
    return Math.min(modelConfidence, CONFIDENCE_CEILINGS.full);
  }
  if (validation.testsPassed === null) {
    return Math.min(modelConfidence, CONFIDENCE_CEILINGS.typecheckOnly);
  }
  return Math.min(modelConfidence, CONFIDENCE_CEILINGS.typecheckFailed);
}

function buildProposePrompt(ctx: ProposeFixContext, fileContent: string): string {
  const rulesBlock = formatRulesForPrompt(ctx.rules);
  const revision = ctx.previous
    ? `
## Previous patch failed validation
Failed stage: ${ctx.previous.failedStage}

Previous before:
\`\`\`
${ctx.previous.patch.before}
\`\`\`

Previous after:
\`\`\`
${ctx.previous.patch.after}
\`\`\`

Exact validation error output:
\`\`\`
${ctx.previous.errorOutput}
\`\`\`

Revise the patch to fix that specific error. Keep the change minimal.
`
    : '';

  return `You are Patch's fix agent. Produce a minimal code fix for one call site.

${rulesBlock}

## ChangeEvent
${JSON.stringify(ctx.event, null, 2)}

## FixInstruction
${JSON.stringify(ctx.instruction, null, 2)}

## MatchSite
${ctx.site.file}:${ctx.site.line}:${ctx.site.column}

Surrounding snippet:
\`\`\`
${ctx.site.snippet}
\`\`\`

Full file (${ctx.site.file}):
\`\`\`
${fileContent}
\`\`\`
${revision}
You may call the read_file tool (max ${ctx.maxFileReads} times this attempt) to inspect sibling files.

When ready, respond with ONLY JSON (no markdown fence required):
{
  "before": "exact code substring to replace",
  "after": "replacement code",
  "confidence": 0.0,
  "rationale": "one or two sentences for the PR description"
}`;
}

/**
 * Provider-backed proposer with optional read_file tool-use loop (capped per attempt).
 */
export async function providerProposeFix(
  ctx: ProposeFixContext,
  provider: ModelProvider,
): Promise<GeneratedFix> {
  const fileContent = readFileSync(join(ctx.repoRoot, ctx.site.file), 'utf8');
  const messages: ModelMessage[] = [
    { role: 'user', content: buildProposePrompt(ctx, fileContent) },
  ];

  for (let round = 0; round < ctx.maxFileReads + 2; round++) {
    const response = await provider.complete({
      maxTokens: 4096,
      tools: [
        {
          name: READ_FILE_TOOL.name,
          description: READ_FILE_TOOL.description,
          input_schema: READ_FILE_TOOL.input_schema as Record<string, unknown>,
        },
      ],
      messages,
    });

    if (response.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: [
          ...(response.content
            ? [{ type: 'text' as const, text: response.content }]
            : []),
          ...response.toolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });
      const toolResultParts = [];
      for (const tc of response.toolCalls) {
        if (tc.name !== 'read_file') {
          toolResultParts.push({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: `Unknown tool: ${tc.name}`,
            is_error: true,
          });
          continue;
        }
        const result = executeReadFile(
          ctx.repoRoot,
          String(tc.input['path'] ?? ''),
          ctx.readState,
          ctx.maxFileReads,
        );
        toolResultParts.push({
          type: 'tool_result' as const,
          tool_use_id: tc.id,
          content: result.ok
            ? `File: ${result.path}\n\n${result.content}`
            : result.error,
          is_error: !result.ok,
        });
      }
      messages.push({ role: 'user', content: toolResultParts });
      continue;
    }

    const text = response.content;
    let lastErr: string | undefined;
    for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
      try {
        return GeneratedFixSchema.parse(extractJson(text));
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (parseAttempt === 0) {
          messages.push({ role: 'assistant', content: text });
          messages.push({
            role: 'user',
            content: `JSON validation failed: ${lastErr}\nRespond with corrected JSON only.`,
          });
          const retry = await provider.complete({
            maxTokens: 2048,
            messages,
          });
          try {
            return GeneratedFixSchema.parse(extractJson(retry.content));
          } catch (err2) {
            lastErr = err2 instanceof Error ? err2.message : String(err2);
          }
        }
      }
    }
    throw new Error(`Model did not return valid fix JSON: ${lastErr}`);
  }

  throw new Error('Exceeded tool-use rounds without a final patch.');
}

/** @deprecated Use providerProposeFix — kept as alias for older imports. */
export const claudeProposeFix = providerProposeFix;

export function heuristicProposeFix(ctx: ProposeFixContext): GeneratedFix {
  const fileContent = readFileSync(join(ctx.repoRoot, ctx.site.file), 'utf8');
  const lines = fileContent.split(/\r?\n/);
  const lineText = lines[ctx.site.line - 1] ?? ctx.site.snippet.trim();
  const { instruction, event } = ctx;

  let after = lineText;
  if (instruction.transform.kind === 'rename_method') {
    const parts = instruction.match_pattern.symbol.split('.');
    const oldName = parts[parts.length - 1] ?? '';
    const newNameMatch = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/.exec(event.new.signature);
    if (oldName && newNameMatch) {
      after = lineText.replace(new RegExp(`\\b${oldName}\\b`), newNameMatch[1]!);
    }
  } else if (instruction.transform.kind === 'change_param') {
    const requiredProp =
      event.surface.path.match(/\.([A-Za-z_][A-Za-z0-9_]*)\??$/)?.[1] ??
      (/currency/i.test(`${event.surface.path} ${event.source_excerpt} ${instruction.transform.instructions}`)
        ? 'currency'
        : undefined);
    const fromTypeError = Boolean(
      requiredProp && ctx.previous?.errorOutput.includes(requiredProp),
    );

    if (requiredProp) {
      if (new RegExp(`\\b${requiredProp}\\s*:`).test(lineText)) {
        // Already satisfies the new required property
        after = lineText;
      } else if (
        event.type === 'added_required_param' ||
        event.type === 'type_changed' ||
        fromTypeError ||
        ctx.previous
      ) {
        const inserted = insertObjectLiteralProp(lineText, requiredProp, "'usd'");
        after =
          inserted !== lineText
            ? inserted
            : lineText.replace(
                /createCharge\(\s*\{\s*amount\s*\}/,
                `createCharge({ amount, ${requiredProp}: 'usd' }`,
              );
        if (after === lineText) {
          after = lineText.replace(
            /amount([,\s}])/g,
            `amount, ${requiredProp}: 'usd'$1`,
          );
        }
      } else {
        after = `${lineText}\n// TODO(patch): ${instruction.transform.instructions}`;
      }
    } else {
      after = `${lineText}\n// TODO(patch): ${instruction.transform.instructions}`;
    }
  } else if (instruction.transform.kind === 'remove_call') {
    after = `/* removed by patch: ${event.surface.path} */`;
  } else if (instruction.transform.kind === 'bump_dependency') {
    const afterObj = (() => {
      try {
        return JSON.parse(event.new.signature) as {
          range?: string;
          version?: string;
        };
      } catch {
        return {};
      }
    })();
    const targetRange = afterObj.range ?? afterObj.version;
    const pkgName = instruction.match_pattern.import_path;
    if (targetRange && lineText.includes(`"${pkgName}"`)) {
      after = lineText.replace(
        /:\s*"[^"]*"/,
        `: "${targetRange}"`,
      );
    } else {
      after = `${lineText}\n// TODO(patch): ${instruction.transform.instructions}`;
    }
  }

  return {
    before: lineText,
    after,
    confidence:
      instruction.transform.kind === 'bump_dependency'
        ? Math.min(event.confidence, event.type === 'dependency_update' ? 0.85 : 0.55)
        : Math.min(event.confidence, 0.55),
    rationale: `Heuristic fix for ${event.type} on ${event.surface.path}. Review carefully.`,
  };
}

/** Insert `prop: value` into a simple object literal on the line, if missing. */
function insertObjectLiteralProp(
  line: string,
  prop: string,
  value: string,
): string {
  if (new RegExp(`\\b${prop}\\s*:`).test(line)) return line;
  const match = /\{([^{}]*)\}/.exec(line);
  if (!match) return line;
  const inner = match[1] ?? '';
  const trimmed = inner.trim();
  const insertion = trimmed.length === 0 ? `${prop}: ${value}` : `${trimmed.replace(/,\s*$/, '')}, ${prop}: ${value}`;
  return `${line.slice(0, match.index)}{ ${insertion} }${line.slice(match.index! + match[0].length)}`;
}

function createWorktree(
  repoRoot: string,
  branchName: string,
  worktreePath: string,
): void {
  mkdirSync(dirname(worktreePath), { recursive: true });
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  const wt = spawnSync(
    'git',
    ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (wt.status !== 0) {
    cpSync(repoRoot, worktreePath, {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        !src.includes('.patch') &&
        !src.includes('.git'),
    });
  }

  // Validation needs deps; git worktrees / copies omit node_modules.
  linkDir(join(repoRoot, 'node_modules'), join(worktreePath, 'node_modules'));
}

function linkDir(from: string, to: string): void {
  if (!existsSync(from) || existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  try {
    symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    try {
      cpSync(from, to, { recursive: true });
    } catch {
      // leave missing — typecheck will fail honestly
    }
  }
}

export function applyPatchToWorktree(
  site: MatchSite,
  generated: GeneratedFix,
  worktreePath: string,
  rationale: string,
): void {
  const filePath = join(worktreePath, site.file);
  if (!existsSync(filePath)) {
    throw new Error(`Match site file missing in worktree: ${site.file}`);
  }
  let content = readFileSync(filePath, 'utf8');
  const before = generated.before.trim();
  const after = generated.after;

  if (before && content.includes(before)) {
    content = content.replace(before, after);
  } else {
    const fileLines = content.split(/\r?\n/);
    const idx = site.line - 1;
    if (idx >= 0 && idx < fileLines.length) {
      const comment = site.file.endsWith('.py')
        ? `# TODO(patch): ${rationale}`
        : `// TODO(patch): ${rationale}`;
      fileLines.splice(idx + 1, 0, comment);
      content = fileLines.join('\n');
    }
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function resetWorktreeFile(repoRoot: string, worktreePath: string, file: string): void {
  const src = join(repoRoot, file);
  const dest = join(worktreePath, file);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8');
  }
}

/**
 * Agentic fix loop:
 * propose → apply → validate (capture errors) → revise (≤ maxAttempts).
 * Attempt count is logged but does NOT affect confidence — only validation ceilings do.
 */
export async function generateAndValidateFix(
  event: ChangeEvent,
  instruction: FixInstruction,
  site: MatchSite,
  options: AgenticFixOptions,
): Promise<ValidatedPatch> {
  const log = options.log ?? defaultLog;
  const maxAttempts = options.maxAttempts ?? MAX_FIX_ATTEMPTS;
  const maxFileReads = options.maxFileReadsPerAttempt ?? MAX_FILE_READS_PER_ATTEMPT;
  const rules =
    options.rules ??
    loadRules(options.repoRoot);

  const propose: ProposeFixFn =
    options.proposeFix ??
    (options.provider
      ? (ctx) => providerProposeFix(ctx, options.provider!)
      : async (ctx) => heuristicProposeFix(ctx));

  const worktreeRoot = options.worktreeRoot ?? join(tmpdir(), 'patch-worktrees');
  const branchName = `${options.branchPrefix ?? 'patch'}/${event.id.slice(0, 8)}`;
  const worktreePath = join(worktreeRoot, branchName.replace(/\//g, '-'));
  createWorktree(options.repoRoot, branchName, worktreePath);

  const attemptLog: FixAttemptRecord[] = [];
  let previous:
    | { patch: GeneratedFix; errorOutput: string; failedStage: 'typecheck' | 'test' }
    | undefined;
  let lastGenerated: GeneratedFix | null = null;
  let lastValidation: ProjectValidation | null = null;
  let totalFileReads = 0;
  const allReadPaths: string[] = [];
  let passedOnAttempt: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Start each attempt from clean file content
    resetWorktreeFile(options.repoRoot, worktreePath, site.file);

    const readState = createReadFileState();
    log('fix attempt starting', {
      attempt,
      maxAttempts,
      site: `${site.file}:${site.line}`,
      revising: Boolean(previous),
    });

    const generated = await propose({
      event,
      instruction,
      site,
      repoRoot: options.repoRoot,
      rules,
      previous,
      readState,
      maxFileReads,
    });
    lastGenerated = generated;

    totalFileReads += readState.reads;
    allReadPaths.push(...readState.paths);

    log('fix proposed', {
      attempt,
      fileReads: readState.reads,
      fileReadPaths: readState.paths,
    });

    applyPatchToWorktree(site, generated, worktreePath, generated.rationale);
    const validation = validateProject(worktreePath, site.language, {
      focusFile: site.file,
    });
    lastValidation = validation;

    const record: FixAttemptRecord = {
      attempt,
      fileReads: readState.reads,
      fileReadPaths: [...readState.paths],
      validationPassed: validation.failedStage === null,
      failedStage: validation.failedStage,
      errorOutput: validation.errorOutput,
    };
    attemptLog.push(record);

    log('fix validation result', {
      attempt,
      passed: record.validationPassed,
      failedStage: validation.failedStage,
      fileReads: readState.reads,
      errorPreview: validation.errorOutput.slice(0, 400),
    });

    if (validation.failedStage === null) {
      passedOnAttempt = attempt;
      break;
    }

    previous = {
      patch: generated,
      errorOutput: validation.errorOutput,
      failedStage: validation.failedStage,
    };
  }

  if (!lastGenerated || !lastValidation) {
    throw new Error('Fix loop produced no patch');
  }

  const confidence = applyConfidenceCeiling(
    lastGenerated.confidence,
    lastValidation,
  );

  const observability: FixObservability = {
    attempts: attemptLog.length,
    totalFileReads,
    fileReadPaths: allReadPaths,
    passedOnAttempt,
    attemptLog,
  };

  log('fix loop complete', {
    attempts: observability.attempts,
    totalFileReads: observability.totalFileReads,
    passedOnAttempt: observability.passedOnAttempt,
    confidence,
    typecheckPassed: lastValidation.typecheckPassed,
    testsPassed: lastValidation.testsPassed,
  });

  const result = PatchResultSchema.parse({
    match_site: site,
    patch: toUnifiedHint(lastGenerated.before, lastGenerated.after, site.file),
    confidence,
    rationale: lastGenerated.rationale,
    change_event_id: event.id,
  });

  return {
    ...result,
    typecheckPassed: lastValidation.typecheckPassed,
    testsPassed: lastValidation.testsPassed,
    branchName,
    worktreePath,
    observability,
  };
}

export function cleanupWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
): void {
  spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  spawnSync('git', ['branch', '-D', branchName], { cwd: repoRoot, encoding: 'utf8' });
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}
