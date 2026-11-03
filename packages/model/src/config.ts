import { z } from 'zod';
import { builtinProvider, keySignupUrl } from './builtins.js';
import {
  MissingModelKeyError,
  ModelProviderIdSchema,
  assertNoEmbeddedSecrets,
  readApiKeyFromEnv,
  type ModelAuth,
  type ModelDialect,
  type ModelProviderId,
} from './types.js';

/**
 * Raised for a model section that cannot work. Every message names the offending field and
 * the fix, and every one of them is thrown before the first network call.
 */
export class InvalidModelConfigError extends Error {
  constructor(problem: string, fix: string) {
    super(`${problem} ${fix}`);
    this.name = 'InvalidModelConfigError';
  }
}

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Header names that carry credentials; they belong in `auth` + `api_key_env`, never here. */
const CREDENTIAL_HEADERS = /^(authorization|proxy-authorization|x-api-key|api-key)$/i;

const ModelAuthSchema = z
  .object({
    scheme: z.enum(['api-key', 'header', 'query', 'none']),
    name: z.string().min(1).optional(),
  })
  .strict();

/**
 * The `model` section of `patch.config.json` — what a human wrote, with a built-in provider's
 * `api_key_env` and `model` defaults filled in.
 *
 * Declared as an interface rather than inferred so the schema and the type can refer to each
 * other (the transform returns this type) without a circularity.
 */
export interface ModelConfig {
  readonly provider: ModelProviderId;
  readonly dialect?: ModelDialect;
  readonly base_url?: string;
  readonly model?: string;
  readonly api_key_env?: string;
  readonly auth?: ModelAuth;
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly tools?: boolean;
}

/**
 * The `model` section of `patch.config.json` — what a human wrote, with built-in defaults for
 * `api_key_env` and `model` filled in.
 *
 * Only the fields that a built-in derives are materialised here, so a written config for a
 * built-in provider parses to exactly the same three keys it did before custom providers
 * existed. Everything else (`dialect`, `auth`, `headers`, `query`, `tools`) is resolved by
 * `resolveModelConfig`, which is also the single place that turns a partial config into the
 * complete thing an adapter can use.
 *
 * Invariants enforced at parse time, before any I/O:
 *  - a custom `provider` needs `dialect`, `base_url` and `model`
 *  - a built-in `provider` may not declare a different `dialect`
 *  - `api_key_env` (when present) is an env var *name*; `auth.scheme: "none"` forbids it
 *  - `auth.scheme: "header" | "query"` requires `auth.name`
 *  - `base_url` is absolute http(s) with no userinfo
 *  - `headers` / `query` carry no credential header names and no key-shaped values
 *  - unknown keys are rejected, so a typo like `baseUrl` fails loudly
 */
const ModelConfigSchemaImpl = z
  .object({
    provider: ModelProviderIdSchema.default('anthropic'),
    dialect: z.enum(['anthropic', 'openai']).optional(),
    base_url: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    api_key_env: z.string().regex(ENV_VAR_NAME, 'api_key_env must be an environment variable name').optional(),
    auth: ModelAuthSchema.optional(),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    tools: z.boolean().optional(),
  })
  .strict()
  .default({})
  .superRefine((raw, ctx) => {
    const preset = builtinProvider(raw.provider);
    const scheme = raw.auth?.scheme ?? preset?.defaultAuth.scheme ?? 'api-key';

    if (!preset) {
      if (!raw.dialect) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dialect'],
          message:
            `model.provider "${raw.provider}" is not a built-in provider, so it needs "dialect". ` +
            'Add "dialect": "openai" for OpenAI-compatible endpoints (OpenRouter, Azure, Ollama, vLLM, proxies) ' +
            'or "dialect": "anthropic" for Messages-API endpoints.',
        });
      }
      if (!raw.base_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['base_url'],
          message: `model.base_url is required for custom provider "${raw.provider}". Add the full endpoint URL, e.g. "https://gateway.internal/v1".`,
        });
      }
      if (!raw.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: `model.model is required for custom provider "${raw.provider}". Add the model id the endpoint expects.`,
        });
      }
    } else if (raw.dialect && raw.dialect !== preset.dialect) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dialect'],
        message:
          `model.provider "${raw.provider}" speaks the "${preset.dialect}" dialect; ` +
          `remove "dialect" or set it to "${preset.dialect}". To use a different wire format, give the endpoint its own provider id.`,
      });
    }

    if (scheme === 'none' && raw.api_key_env) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['api_key_env'],
        message:
          'model.api_key_env is set but model.auth.scheme is "none". Remove "api_key_env" for a keyless endpoint, or drop the "none" scheme.',
      });
    }
    if (scheme !== 'none' && !raw.api_key_env && !preset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['api_key_env'],
        message:
          `Custom provider "${raw.provider}" needs "api_key_env" (the NAME of the env var holding the key), ` +
          'or "auth": { "scheme": "none" } for an endpoint that takes no key (e.g. a local Ollama server).',
      });
    }
    if ((scheme === 'header' || scheme === 'query') && !raw.auth?.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth', 'name'],
        message: `model.auth.name is required when scheme is "${scheme}" (the header or query parameter the key is sent in).`,
      });
    }

    if (raw.base_url) {
      let url: URL;
      try {
        url = new URL(raw.base_url);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['base_url'],
          message: `model.base_url "${raw.base_url}" is not a valid absolute URL.`,
        });
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['base_url'],
          message: `model.base_url must be http(s), got "${url.protocol}".`,
        });
      }
      if (url.username || url.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['base_url'],
          message:
            'model.base_url must not embed credentials. Put the secret in the env var named by "api_key_env" instead.',
        });
      }
    }

    for (const name of Object.keys(raw.headers ?? {})) {
      if (CREDENTIAL_HEADERS.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headers', name],
          message:
            `model.headers must not carry the credential header "${name}". ` +
            'Set "api_key_env" (plus "auth" when the header is not the dialect default) so the key stays out of the config file.',
        });
      }
    }

    try {
      assertNoEmbeddedSecrets(raw);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })
  .transform((raw): ModelConfig => {
    const preset = builtinProvider(raw.provider);
    if (!preset) return { ...raw };
    return {
      ...raw,
      api_key_env: raw.auth?.scheme === 'none' ? undefined : (raw.api_key_env ?? preset.defaultApiKeyEnv),
      model: raw.model ?? preset.defaultModel,
    };
  });

export const ModelConfigSchema: z.ZodType<ModelConfig, z.ZodTypeDef, unknown> =
  ModelConfigSchemaImpl;

export const DEFAULT_MODEL_CONFIG: ModelConfig = ModelConfigSchema.parse({});

/**
 * A `ModelConfig` with every decision made: nothing optional, nothing to re-derive.
 * This is what an adapter receives, so no caller narrows a field or re-applies a default.
 */
export interface ResolvedModelConfig {
  readonly provider: ModelProviderId;
  /** Human label — the built-in label, or the custom provider's own id. */
  readonly label: string;
  readonly dialect: ModelDialect;
  /** Vendor base URL override. Undefined keeps the SDK's own default. */
  readonly baseUrl?: string;
  readonly model: string;
  /** Env var holding the key. Undefined only when `auth.scheme === 'none'`. */
  readonly apiKeyEnv?: string;
  readonly auth: ModelAuth;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  /** May tool definitions be sent to this endpoint? */
  readonly tools: boolean;
}

/**
 * Apply built-in defaults and close the optional fields. Pure: reads no env, makes no network
 * call, never fails on a missing key. Throws `InvalidModelConfigError` for a gap the schema
 * could not see (defensive — the schema is expected to have caught it).
 */
export function resolveModelConfig(config: ModelConfig): ResolvedModelConfig {
  const preset = builtinProvider(config.provider);
  const dialect = config.dialect ?? preset?.dialect;
  if (!dialect) {
    throw new InvalidModelConfigError(
      `Model provider "${config.provider}" declares no dialect.`,
      'Add "dialect": "openai" or "anthropic" to patch.config.json.',
    );
  }
  const model = config.model ?? preset?.defaultModel;
  if (!model) {
    throw new InvalidModelConfigError(
      `Model provider "${config.provider}" has no model id.`,
      'Add "model" to patch.config.json.',
    );
  }

  const auth: ModelAuth = config.auth ?? preset?.defaultAuth ?? { scheme: 'api-key' };
  const apiKeyEnv =
    auth.scheme === 'none'
      ? undefined
      : (config.api_key_env ?? preset?.defaultApiKeyEnv);

  return {
    provider: config.provider,
    label: preset?.label ?? config.provider,
    dialect,
    ...(config.base_url ? { baseUrl: config.base_url } : {}),
    model,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    auth,
    headers: config.headers ?? {},
    query: config.query ?? {},
    tools: config.tools ?? true,
  };
}

/**
 * Read the key at the boundary — env only — and fail with the one error the CLI knows how to
 * print. Returns `undefined` only for a keyless endpoint (`auth.scheme: 'none'`).
 */
export function assertModelKeyPresent(config: ModelConfig): string | undefined {
  const resolved = resolveModelConfig(config);
  if (resolved.auth.scheme === 'none') return undefined;
  if (!resolved.apiKeyEnv) {
    throw new InvalidModelConfigError(
      `Model provider "${resolved.provider}" needs an API key but names no env var.`,
      'Add "api_key_env" (the NAME of the variable holding the key), or "auth": { "scheme": "none" } for a keyless endpoint.',
    );
  }
  const key = readApiKeyFromEnv(resolved.apiKeyEnv);
  if (!key) {
    throw new MissingModelKeyError(
      resolved.provider,
      resolved.apiKeyEnv,
      keySignupUrl(resolved.provider),
    );
  }
  return key;
}

/** Redaction-safe rendering: origin + path only. Never userinfo, never query values. */
function displayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/**
 * One line for humans, safe to print in CI logs.
 *
 *   anthropic (claude-sonnet-4-20250514) via $ANTHROPIC_API_KEY
 *   azure-acme (gpt-4o) at https://acme.openai.azure.com/openai/deployments/gpt-4o via $AZURE_OPENAI_API_KEY [openai dialect]
 *   ollama (llama3.2) at http://localhost:11434/v1 — no api key [openai dialect], tools disabled
 */
export function describeModel(config: ModelConfig): string {
  const resolved = resolveModelConfig(config);
  const parts = [`${resolved.provider} (${resolved.model})`];
  if (resolved.baseUrl) parts.push(`at ${displayUrl(resolved.baseUrl)}`);
  parts.push(resolved.apiKeyEnv ? `via $${resolved.apiKeyEnv}` : '— no api key');
  if (!builtinProvider(resolved.provider)) parts.push(`[${resolved.dialect} dialect]`);
  let line = parts.join(' ');
  if (!resolved.tools) line += ', tools disabled';
  return line;
}

/**
 * Inverse of `ModelConfigSchema`, for `patch init`: emits only the fields a reader needs, so a
 * built-in provider's block stays `{provider, api_key_env, model}` and
 * `parse(serialize(parse(x)))` is identical to `parse(x)`.
 */
export function serializeModelConfig(config: ModelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { provider: config.provider };
  if (config.dialect) out['dialect'] = config.dialect;
  if (config.base_url) out['base_url'] = config.base_url;
  // api_key_env before model keeps a built-in block byte-identical to pre-custom-provider files.
  if (config.api_key_env) out['api_key_env'] = config.api_key_env;
  if (config.model) out['model'] = config.model;
  if (config.auth) out['auth'] = { ...config.auth };
  if (config.headers && Object.keys(config.headers).length > 0) {
    out['headers'] = { ...config.headers };
  }
  if (config.query && Object.keys(config.query).length > 0) {
    out['query'] = { ...config.query };
  }
  if (config.tools !== undefined) out['tools'] = config.tools;
  return out;
}
