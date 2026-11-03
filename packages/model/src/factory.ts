import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { AnthropicProvider } from './anthropic.js';
import { assertModelKeyPresent, resolveModelConfig, type ModelConfig } from './config.js';
import { DIALECTS } from './dialects.js';
import { authTransport } from './endpoint.js';
import { OpenAIProvider } from './openai.js';
import { assertNoEmbeddedSecrets, type ModelProvider } from './types.js';

export interface CreateModelProviderOptions {
  /** The `model` section of patch.config.json. */
  config: ModelConfig;
  /** Test/CI override: skips the env read. */
  apiKey?: string;
  anthropicClient?: Anthropic;
  openaiClient?: OpenAI;
}

/**
 * Build a provider from the `model` section of patch.config.json.
 *
 * Order is the contract: refuse embedded secrets → resolve the config → read the key from the
 * named env var → pick the dialect adapter. Everything that can fail on config or credentials
 * fails here, before an SDK is constructed and before any network call.
 *
 * Note what this function does not do: it never branches on the provider id. A custom endpoint
 * is the same code path as a built-in, with different data.
 */
export function createModelProvider(options: CreateModelProviderOptions): ModelProvider {
  assertNoEmbeddedSecrets(options.config);

  const resolved = resolveModelConfig(options.config);
  const apiKey = options.apiKey ?? assertModelKeyPresent(options.config);
  const transport = authTransport(resolved.dialect, resolved.auth, apiKey);
  const client =
    resolved.dialect === 'anthropic' ? options.anthropicClient : options.openaiClient;

  return DIALECTS[resolved.dialect]({
    id: resolved.provider,
    model: resolved.model,
    ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
    headers: { ...resolved.headers, ...transport.headers },
    query: { ...resolved.query, ...transport.query },
    tools: resolved.tools,
    ...(client ? { client } : {}),
  });
}

export { AnthropicProvider, OpenAIProvider };
