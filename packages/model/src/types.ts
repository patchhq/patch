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
 * Pluggable LLM backend used by Classify and Fix-generation.
 * SDKs stay behind this interface — stages never import them directly.
 */
export interface ModelProvider {
  readonly id: 'anthropic' | 'openai';
  readonly model: string;
  complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>;
}

export const ModelProviderIdSchema = z.enum(['anthropic', 'openai']);
export type ModelProviderId = z.infer<typeof ModelProviderIdSchema>;

export const ModelConfigSchema = z
  .object({
    provider: ModelProviderIdSchema.default('anthropic'),
    /**
     * Name of the environment variable that holds the API key.
     * Never store the key itself in patch.config.json.
     */
    api_key_env: z.string().min(1).optional(),
    /** Optional model id override. */
    model: z.string().min(1).optional(),
  })
  .default({})
  .transform((raw) => {
    const provider = raw.provider ?? 'anthropic';
    const api_key_env =
      raw.api_key_env ??
      (provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
    const model =
      raw.model ??
      (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514');
    return { provider, api_key_env, model };
  });

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const DEFAULT_MODEL_CONFIG: ModelConfig = ModelConfigSchema.parse({});

export function keySignupUrl(provider: ModelProviderId): string {
  return provider === 'openai'
    ? 'https://platform.openai.com/api-keys'
    : 'https://console.anthropic.com/settings/keys';
}

/** Thrown when the configured provider's API key env var is unset. */
export class MissingModelKeyError extends Error {
  readonly envVar: string;
  readonly provider: ModelProviderId;

  constructor(provider: ModelProviderId, envVar: string) {
    super(
      `Missing API key for model provider "${provider}". ` +
        `Set environment variable ${envVar} (get a key at ${keySignupUrl(provider)}).`,
    );
    this.name = 'MissingModelKeyError';
    this.envVar = envVar;
    this.provider = provider;
  }
}

export function readApiKeyFromEnv(envVar: string): string | undefined {
  const value = process.env[envVar]?.trim();
  return value || undefined;
}

export function assertModelKeyPresent(config: ModelConfig): string {
  const key = readApiKeyFromEnv(config.api_key_env);
  if (!key) {
    throw new MissingModelKeyError(config.provider, config.api_key_env);
  }
  return key;
}

/** Reject config objects that accidentally embed a key-shaped string. */
export function assertNoEmbeddedSecrets(configValue: unknown): void {
  const json = JSON.stringify(configValue);
  // sk-ant-… (Anthropic) / sk-… (OpenAI) / common PEM headers
  if (
    /sk-ant-[A-Za-z0-9_-]{20,}/.test(json) ||
    /sk-[A-Za-z0-9]{20,}/.test(json) ||
    /BEGIN (RSA )?PRIVATE KEY/.test(json)
  ) {
    throw new Error(
      'Refusing to use config that appears to contain an API key or private key. ' +
        'Store only provider + api_key_env in patch.config.json.',
    );
  }
}
