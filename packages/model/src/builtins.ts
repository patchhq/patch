import {
  registerBuiltinSignupUrls,
  type ModelAuth,
  type ModelDialect,
  type ModelProviderId,
} from './types.js';

/**
 * One provider Patch ships defaults for.
 *
 * This is the only list of its kind: `patch init`'s menu, the default `api_key_env` / `model`
 * in `ModelConfigSchema`, and every key signup link are derived from these rows.
 */
export interface BuiltinProvider {
  readonly id: ModelProviderId;
  /** Human label for `init`'s menu and documentation tables. */
  readonly label: string;
  /** One-line description of the family, used by `init`. */
  readonly blurb: string;
  readonly dialect: ModelDialect;
  readonly defaultApiKeyEnv: string;
  readonly defaultModel: string;
  readonly defaultAuth: ModelAuth;
  readonly signupUrl: string;
}

/** Order is `patch init`'s menu order; index 0 is the `--yes` / non-TTY default. */
export const BUILTIN_PROVIDERS: readonly BuiltinProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    blurb: 'Claude models on api.anthropic.com',
    dialect: 'anthropic',
    defaultApiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    defaultAuth: { scheme: 'api-key' },
    signupUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT / Codex-style)',
    blurb: 'GPT models on api.openai.com',
    dialect: 'openai',
    defaultApiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    defaultAuth: { scheme: 'api-key' },
    signupUrl: 'https://platform.openai.com/api-keys',
  },
];

// The error class lives in types.ts and needs the signup URL for a built-in id without
// importing this module (that would be a cycle).
registerBuiltinSignupUrls(
  Object.fromEntries(
    BUILTIN_PROVIDERS.map((p) => [p.id, p.signupUrl] as const),
  ) as Record<string, string>,
);

export function builtinProvider(id: ModelProviderId): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

export function isBuiltinProvider(id: ModelProviderId): boolean {
  return builtinProvider(id) !== undefined;
}

/** Signup URL for a built-in id; `undefined` for a custom endpoint. */
export function keySignupUrl(id: ModelProviderId): string | undefined {
  return builtinProvider(id)?.signupUrl;
}
