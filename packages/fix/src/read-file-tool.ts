import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import {
  MAX_FILE_READS_PER_ATTEMPT,
} from '@patch-dev/core';

const READ_FILE_TOOL = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file from the customer repository. Path must be relative to the repo root. Use this to pull surrounding context (helpers, types, siblings). Max 3 reads per fix attempt.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Repo-relative path, e.g. src/helpers/charge.ts',
      },
    },
    required: ['path'],
  },
};

export { READ_FILE_TOOL };

export interface ReadFileToolState {
  reads: number;
  paths: string[];
}

export function createReadFileState(): ReadFileToolState {
  return { reads: 0, paths: [] };
}

/**
 * Resolve and read a file under repoRoot. Rejects path traversal and binary-ish files.
 */
export function executeReadFile(
  repoRoot: string,
  requestedPath: string,
  state: ReadFileToolState,
  maxReads: number = MAX_FILE_READS_PER_ATTEMPT,
): { ok: true; path: string; content: string } | { ok: false; error: string } {
  if (state.reads >= maxReads) {
    return {
      ok: false,
      error: `read_file limit reached (${maxReads} per attempt). Use the context you already have.`,
    };
  }

  const cleaned = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0')) {
    return { ok: false, error: 'Invalid path.' };
  }

  const abs = normalize(
    isAbsolute(cleaned) ? cleaned : resolve(repoRoot, cleaned),
  );
  const root = normalize(resolve(repoRoot));
  const rel = relative(root, abs);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: 'Path escapes repository root.' };
  }

  // Block sensitive / huge trees
  const blocked = ['node_modules', '.git', '.patch', 'dist', 'coverage'];
  if (rel.split(/[/\\]/).some((p) => blocked.includes(p))) {
    return { ok: false, error: `Reading ${rel} is not allowed.` };
  }

  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return { ok: false, error: `File not found: ${rel}` };
  }

  const size = statSync(abs).size;
  if (size > 200_000) {
    return { ok: false, error: `File too large (${size} bytes): ${rel}` };
  }

  let content: string;
  try {
    content = readFileSync(abs, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read ${rel}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (content.includes('\0')) {
    return { ok: false, error: `Binary file not supported: ${rel}` };
  }

  // Soft truncate for the model
  if (content.length > 40_000) {
    content = `${content.slice(0, 40_000)}\n…[truncated]`;
  }

  state.reads += 1;
  const posix = rel.split(sep).join('/');
  state.paths.push(posix);

  return { ok: true, path: posix, content };
}

/** Join path helpers for tests. */
export function joinRepo(repoRoot: string, ...parts: string[]): string {
  return join(repoRoot, ...parts);
}
