import { afterEach, describe, expect, it } from 'vitest';
import { resolveGithubAuth, describeMissingGithubAuth } from '../auth.js';

describe('resolveGithubAuth', () => {
  const envKeys = [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'PATCH_GITHUB_APP_ID',
    'PATCH_GITHUB_APP_PRIVATE_KEY',
    'PATCH_GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_INSTALLATION_ID',
  ] as const;

  const snapshot: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of envKeys) {
      const prev = snapshot[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
      delete snapshot[key];
    }
  });

  function setEnv(key: (typeof envKeys)[number], value: string | undefined) {
    snapshot[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('uses GITHUB_TOKEN when present', async () => {
    setEnv('GITHUB_TOKEN', 'ghp_test_token');
    setEnv('PATCH_GITHUB_APP_ID', undefined);
    setEnv('PATCH_GITHUB_APP_PRIVATE_KEY', undefined);

    const auth = await resolveGithubAuth({ owner: 'o', repo: 'r' });
    expect(auth).toEqual({ token: 'ghp_test_token', source: 'pat' });
  });

  it('returns null when nothing is configured', async () => {
    for (const key of envKeys) setEnv(key, undefined);
    const auth = await resolveGithubAuth({ owner: 'o', repo: 'r' });
    expect(auth).toBeNull();
    expect(describeMissingGithubAuth()).toMatch(/GITHUB_TOKEN/);
  });

  it('prefers PAT over App credentials', async () => {
    setEnv('GITHUB_TOKEN', 'ghp_prefer_me');
    setEnv('PATCH_GITHUB_APP_ID', '123');
    setEnv('PATCH_GITHUB_APP_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');

    const auth = await resolveGithubAuth({ owner: 'o', repo: 'r' });
    expect(auth?.source).toBe('pat');
    expect(auth?.token).toBe('ghp_prefer_me');
  });
});
