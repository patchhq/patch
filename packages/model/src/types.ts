import { z } from 'zod';

/** Chat roles shared across providers. */
export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelTextPart {
  type: 'text';
  text: string;
}

export interface ModelToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelToolResultPart {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ModelContentPart = ModelTextPart | ModelToolUsePart | ModelToolResultPart;

export interface ModelMessage {
  role: ModelRole;
  /** Plain string or structured parts (assistant tool_use / user tool_result). */
  content: string | ModelContentPart[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelCompleteRequest {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  /** Optional JSON Schema hint for structured responses (best-effort per provider). */
  responseSchema?: Record<string, unknown>;
  maxTokens?: number;
  /** System prompt (providers that lack a system role fold this into messages). */
  system?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelCompleteResult {
  content: string;
  toolCalls: ModelToolCall[];
  raw: unknown;
}

/**
 * Wire format an adapter speaks.
 *
 * Closed on purpose: each variant needs a real request/response translator, so adding one is
 * a code change, not a config change. Provider *identity* is open (see `ModelProviderId`).
 */
export type ModelDialect = 'anthropic' | 'openai';

/**
 * Open provider identity. Built-in ids (`anthropic`, `openai`) get defaults from
 * `BUILTIN_PROVIDERS`; any other slug names a custom endpoint declared in `patch.config.json`.
 */
export type ModelProviderId = string;

export const ModelProviderIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,63}$/,
    'provider must be 1–64 characters of lowercase letters, digits, ".", "_" or "-"',
  );

/**
 * How the resolved key reaches the endpoint.
 *
 * - `api-key` — the dialect's native transport: `x-api-key` for Anthropic,
 *   `Authorization: Bearer` for OpenAI.
 * - `header` — `<name>: <key>` (Azure OpenAI's `api-key`).
 * - `query` — `?<name>=<key>`.
 * - `none` — no credentials (local model server). Legal only without `api_key_env`.
 */
export type ModelAuthScheme = 'api-key' | 'header' | 'query' | 'none';

export interface ModelAuth {
  readonly scheme: ModelAuthScheme;
  /** Required for `header` and `query`. */
  readonly name?: string;
}

/**
 * What an endpoint can do. Absent means "unknown — assume the capability is present".
 *
 * `fix` needs `tools` for its `read_file` loop; a provider that reports `tools: false` gets a
 * single-shot proposal instead of a conversation that silently fails to produce tool calls.
 */
export interface ModelCapabilities {
  readonly tools?: boolean;
}

/**
 * Pluggable LLM backend used by Classify and Fix-generation.
 * SDKs stay behind this interface — stages never import them directly.
 *
 * This interface *is* the in-process extension point: implement it and hand the object to a
 * stage (or to `runScan({ provider })`). Nothing above it knows where it came from.
 */
export interface ModelProvider {
  /** Built-in id or the custom slug from `patch.config.json` — used for logs only. */
  readonly id: ModelProviderId;
  readonly model: string;
  readonly capabilities?: ModelCapabilities;
  complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>;
}

/**
 * Signup URL for a provider Patch ships defaults for; `undefined` for custom endpoints.
 * Re-exported from `builtins.ts`; kept here so the error class can use it without a cycle.
 */
export function keySignupUrlFor(id: ModelProviderId): string | undefined {
  return BUILTIN_SIGNUP_URLS[id];
}

/** Filled by `builtins.ts` at import time — one table, one owner (see `registerBuiltinSignupUrls`). */
const BUILTIN_SIGNUP_URLS: Record<string, string | undefined> = {};

export function registerBuiltinSignupUrls(urls: Record<string, string>): void {
  Object.assign(BUILTIN_SIGNUP_URLS, urls);
}

/** Thrown when the configured provider's API key env var is unset. */
export class MissingModelKeyError extends Error {
  readonly envVar: string;
  readonly provider: ModelProviderId;

  constructor(provider: ModelProviderId, envVar: string, signupUrl?: string) {
    const url = signupUrl ?? keySignupUrlFor(provider);
    super(
      `Missing API key for model provider "${provider}". ` +
        `Set environment variable ${envVar}` +
        (url ? ` (get a key at ${url}).` : '.'),
    );
    this.name = 'MissingModelKeyError';
    this.envVar = envVar;
    this.provider = provider;
  }
}

export function readApiKeyFromEnv(envVar: string | undefined): string | undefined {
  if (!envVar) return undefined;
  const value = process.env[envVar]?.trim();
  return value || undefined;
}

/** Key-shaped material we refuse to accept in `patch.config.json`. */
const KEY_SHAPED = /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY/;
/** `https://user:pass@host` — a credential hidden in a URL. */
const URL_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^\s/"']+@/i;

export function containsKeyShapedSecret(text: string): boolean {
  return KEY_SHAPED.test(text);
}

/**
 * Reject config objects that embed credentials.
 *
 * Single owner of "what a secret looks like": key-shaped strings (Anthropic/OpenAI/PEM) and
 * URL userinfo (`https://user:pass@host`). Pure and side-effect free, so it can run at parse
 * time, in `init` before writing the file, and again in the factory.
 */
export function assertNoEmbeddedSecrets(configValue: unknown): void {
  const json = JSON.stringify(configValue);
  if (containsKeyShapedSecret(json) || URL_USERINFO.test(json)) {
    throw new Error(
      'Refusing to use config that appears to contain an API key or private key. ' +
        'Store only the provider id and the env var *name* in patch.config.json; ' +
        'never embed a key, a password, or a credential in a URL.',
    );
  }
}
