import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ValidatedPatch } from '@patch-dev/fix';

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Build one branch with all successful per-site fixes and push it for a PR.
 * Returns the branch name, or null if nothing to push / git unavailable.
 */
export function prepareAndPushFixBranch(params: {
  repoRoot: string;
  results: ValidatedPatch[];
  token: string;
  owner: string;
  repo: string;
  branchName: string;
  baseBranch?: string;
}): { branchName: string } | { error: string } {
  const successful = params.results.filter((r) => r.typecheckPassed);
  if (successful.length === 0) {
    return { error: 'no typecheck-passing fixes to push' };
  }

  const base = params.baseBranch ?? 'main';
  const { repoRoot, branchName, token, owner, repo } = params;

  // Start from current HEAD (Actions checkout is usually the default branch)
  let r = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = r.stdout.trim() || base;

  r = git(repoRoot, ['checkout', '-B', branchName, current]);
  if (r.status !== 0) {
    return { error: `git checkout failed: ${r.stderr || r.stdout}` };
  }

  for (const result of successful) {
    const src = join(result.worktreePath, result.match_site.file);
    const dest = join(repoRoot, result.match_site.file);
    if (!existsSync(src)) {
      return { error: `missing patched file in worktree: ${result.match_site.file}` };
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
    git(repoRoot, ['add', '--', result.match_site.file]);
  }

  r = git(repoRoot, ['status', '--porcelain']);
  if (!r.stdout.trim()) {
    // Still push an empty branch? Prefer skip PR path
    git(repoRoot, ['checkout', current]);
    return { error: 'no file changes after applying worktree patches' };
  }

  r = git(
    repoRoot,
    [
      'commit',
      '-m',
      `fix: apply Patch agentic fixes (${successful.length} site(s))`,
    ],
    {
      GIT_AUTHOR_NAME: 'Patch',
      GIT_AUTHOR_EMAIL: 'patch[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Patch',
      GIT_COMMITTER_EMAIL: 'patch[bot]@users.noreply.github.com',
    },
  );
  if (r.status !== 0) {
    return { error: `git commit failed: ${r.stderr || r.stdout}` };
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  r = git(repoRoot, ['push', '--force', remoteUrl, `HEAD:refs/heads/${branchName}`]);
  if (r.status !== 0) {
    git(repoRoot, ['checkout', current]);
    return { error: `git push failed: ${r.stderr || r.stdout}` };
  }

  // Return to previous branch so the working tree stays usable
  git(repoRoot, ['checkout', current]);

  return { branchName };
}
