/**
 * Fix generation + agentic validation loop.
 *
 * Prefer `generateAndValidateFix` (bounded retries with validation feedback).
 */
export {
  CONFIDENCE_CEILINGS,
  generateAndValidateFix,
  cleanupWorktree,
  applyPatchToWorktree,
  toUnifiedHint,
  fromUnifiedHint,
  heuristicProposeFix,
  claudeProposeFix,
  type AgenticFixOptions,
  type FixAttemptRecord,
  type FixObservability,
  type GeneratedFix,
  type ProposeFixContext,
  type ProposeFixFn,
  type ValidatedPatch,
} from './agentic-fix.js';

export {
  getValidator,
  validateProject,
  TypescriptValidator,
  PythonValidator,
  RustValidator,
  GoValidator,
  type ProjectValidation,
} from './validators.js';

export {
  READ_FILE_TOOL,
  createReadFileState,
  executeReadFile,
  type ReadFileToolState,
} from './read-file-tool.js';

import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  PatchResultSchema,
  type ChangeEvent,
  type FixInstruction,
  type MatchSite,
  type PatchResult,
} from '@patch-dev/core';
import {
  CONFIDENCE_CEILINGS,
  fromUnifiedHint,
  generateAndValidateFix,
  toUnifiedHint,
  type ValidatedPatch,
} from './agentic-fix.js';
import { validateProject } from './validators.js';

export interface GenerateFixOptions {
  apiKey?: string;
  model?: string;
  repoRoot: string;
}

/**
 * One-shot proposal that still runs a single validation pass (maxAttempts=1).
 * Prefer generateAndValidateFix for the full agentic loop.
 */
export async function generateFix(
  event: ChangeEvent,
  instruction: FixInstruction,
  site: MatchSite,
  options: GenerateFixOptions,
): Promise<PatchResult> {
  const validated = await generateAndValidateFix(event, instruction, site, {
    repoRoot: options.repoRoot,
    apiKey: options.apiKey,
    model: options.model,
    maxAttempts: 1,
  });
  return PatchResultSchema.parse({
    match_site: validated.match_site,
    patch: validated.patch,
    confidence: validated.confidence,
    rationale: validated.rationale,
    change_event_id: validated.change_event_id,
  });
}

export interface ApplyAndValidateOptions {
  repoRoot: string;
  worktreeRoot?: string;
  branchPrefix?: string;
}

/**
 * Apply an already-proposed PatchResult once and validate (no revise loop).
 * Kept for callers that separate proposal from validation.
 */
export function applyAndValidate(
  result: PatchResult,
  options: ApplyAndValidateOptions,
): ValidatedPatch {
  const worktreeRoot = options.worktreeRoot ?? join(tmpdir(), 'patch-worktrees');
  const branchName = `${options.branchPrefix ?? 'patch'}/${result.change_event_id ?? randomUUID().slice(0, 8)}`;
  const worktreePath = join(worktreeRoot, branchName.replace(/\//g, '-'));

  mkdirSync(worktreeRoot, { recursive: true });
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  const wt = spawnSync(
    'git',
    ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
    { cwd: options.repoRoot, encoding: 'utf8' },
  );

  if (wt.status !== 0) {
    cpSync(options.repoRoot, worktreePath, {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        !src.includes('.patch') &&
        !src.includes('.git'),
    });
  }

  const { before, after } = fromUnifiedHint(result.patch);
  const filePath = join(worktreePath, result.match_site.file);
  let content = readFileSync(filePath, 'utf8');
  if (before && content.includes(before)) {
    content = content.replace(before, after);
  } else {
    const fileLines = content.split(/\r?\n/);
    const idx = result.match_site.line - 1;
    if (idx >= 0 && idx < fileLines.length) {
      fileLines.splice(idx + 1, 0, `// TODO(patch): ${result.rationale}`);
      content = fileLines.join('\n');
    }
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');

  const validation = validateProject(worktreePath, result.match_site.language, {
    focusFile: result.match_site.file,
  });
  let confidence = result.confidence;
  if (!validation.typecheckPassed) {
    confidence = Math.min(confidence, CONFIDENCE_CEILINGS.typecheckFailed);
  } else if (validation.testsPassed === true) {
    confidence = Math.min(confidence, CONFIDENCE_CEILINGS.full);
  } else if (validation.testsPassed === null) {
    confidence = Math.min(confidence, CONFIDENCE_CEILINGS.typecheckOnly);
  } else {
    confidence = Math.min(confidence, CONFIDENCE_CEILINGS.typecheckFailed);
  }

  return {
    ...result,
    patch: toUnifiedHint(before, after, result.match_site.file),
    confidence,
    typecheckPassed: validation.typecheckPassed,
    testsPassed: validation.testsPassed,
    branchName,
    worktreePath,
    observability: {
      attempts: 1,
      totalFileReads: 0,
      fileReadPaths: [],
      passedOnAttempt: validation.failedStage === null ? 1 : null,
      attemptLog: [
        {
          attempt: 1,
          fileReads: 0,
          fileReadPaths: [],
          validationPassed: validation.failedStage === null,
          failedStage: validation.failedStage,
          errorOutput: validation.errorOutput,
        },
      ],
    },
  };
}
