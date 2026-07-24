import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface GithubAuthResult {
  token: string;
  /** How the token was obtained. */
  source: 'pat' | 'github-app';
  installationId?: number;
}

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function readPat(): string | undefined {
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  return token?.trim() || undefined;
}

function readAppCredentials():
  | { appId: string; privateKey: string; installationId?: number }
  | undefined {
  const appId =
    process.env['PATCH_GITHUB_APP_ID'] ?? process.env['GITHUB_APP_ID'];
  const privateKeyRaw =
    process.env['PATCH_GITHUB_APP_PRIVATE_KEY'] ??
    process.env['GITHUB_APP_PRIVATE_KEY'];
  if (!appId?.trim() || !privateKeyRaw?.trim()) return undefined;

  const installationRaw =
    process.env['PATCH_GITHUB_APP_INSTALLATION_ID'] ??
    process.env['GITHUB_APP_INSTALLATION_ID'];
  const installationId = installationRaw ? Number(installationRaw) : undefined;

  return {
    appId: appId.trim(),
    privateKey: normalizePrivateKey(privateKeyRaw.trim()),
    installationId:
      installationId !== undefined && Number.isFinite(installationId)
        ? installationId
        : undefined,
  };
}

/**
 * Resolve a GitHub API token for Patch publish.
 *
 * Precedence:
 * 1. `GITHUB_TOKEN` / `GH_TOKEN` (PAT or Actions token)
 * 2. GitHub App via `PATCH_GITHUB_APP_ID` + `PATCH_GITHUB_APP_PRIVATE_KEY`
 *    (optional `PATCH_GITHUB_APP_INSTALLATION_ID`; otherwise looked up for owner/repo)
 */
export async function resolveGithubAuth(options: {
  owner: string;
  repo: string;
}): Promise<GithubAuthResult | null> {
  const pat = readPat();
  if (pat) {
    return { token: pat, source: 'pat' };
  }

  const app = readAppCredentials();
  if (!app) return null;

  const auth = createAppAuth({
    appId: app.appId,
    privateKey: app.privateKey,
  });

  let installationId = app.installationId;
  if (!installationId) {
    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: app.appId,
        privateKey: app.privateKey,
      },
    });
    try {
      const { data } = await appOctokit.apps.getRepoInstallation({
        owner: options.owner,
        repo: options.repo,
      });
      installationId = data.id;
    } catch {
      return null;
    }
  }

  const installationAuth = await auth({
    type: 'installation',
    installationId,
  });

  return {
    token: installationAuth.token,
    source: 'github-app',
    installationId,
  };
}

export function describeMissingGithubAuth(): string {
  return (
    'no GitHub credentials — set GITHUB_TOKEN, or PATCH_GITHUB_APP_ID + ' +
    'PATCH_GITHUB_APP_PRIVATE_KEY (see docs/github-app.md)'
  );
}
