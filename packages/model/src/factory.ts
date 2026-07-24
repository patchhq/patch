import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import {
  assertModelKeyPresent,
  assertNoEmbeddedSecrets,
  type ModelConfig,
  type ModelProvider,
} from './types.js';

export interface CreateModelProviderOptions {
  config: ModelConfig;
  /** Test overrides — skip env key read when provided. */
  apiKey?: string;
  anthropicClient?: ConstructorParameters<typeof AnthropicProvider>[0]['client'];
  openaiClient?: ConstructorParameters<typeof OpenAIProvider>[0]['client'];
}

/**
 * Build a provider from patch.config.json `model` section.
 * Reads the API key from the configured env var (never from the config file).
 */
export function createModelProvider(
  options: CreateModelProviderOptions,
): ModelProvider {
  assertNoEmbeddedSecrets(options.config);
  const apiKey = options.apiKey ?? assertModelKeyPresent(options.config);
  const { provider, model } = options.config;

  if (provider === 'openai') {
    return new OpenAIProvider({
      apiKey,
      model,
      client: options.openaiClient,
    });
  }

  return new AnthropicProvider({
    apiKey,
    model,
    client: options.anthropicClient,
  });
}
