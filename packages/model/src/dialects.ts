import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { ModelDialect, ModelProvider, ModelProviderId } from './types.js';

/** What a dialect factory needs. Same shape for every dialect, so the factory never branches. */
export interface DialectBuildOptions {
  readonly id: ModelProviderId;
  readonly model: string;
  readonly baseUrl?: string;
  /** Final header set, auth included. */
  readonly headers: Readonly<Record<string, string>>;
  /** Final query parameters, auth included. */
  readonly query: Readonly<Record<string, string>>;
  readonly tools: boolean;
  /** Test seam: an injected client owns its own transport. */
  readonly client?: unknown;
}

/**
 * The only place a wire dialect is bound to an implementation.
 *
 * `Record<ModelDialect, …>` is exhaustive by type, so adding a dialect fails to compile until
 * its adapter exists. Not exported from the package: callers pick a dialect in config, not a class.
 */
export const DIALECTS: Record<ModelDialect, (options: DialectBuildOptions) => ModelProvider> = {
  anthropic: (options) =>
    new AnthropicProvider({
      id: options.id,
      model: options.model,
      tools: options.tools,
      headers: options.headers,
      query: options.query,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.client ? { client: options.client as ConstructorParameters<typeof AnthropicProvider>[0]['client'] } : {}),
    }),
  openai: (options) =>
    new OpenAIProvider({
      id: options.id,
      model: options.model,
      tools: options.tools,
      headers: options.headers,
      query: options.query,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.client ? { client: options.client as ConstructorParameters<typeof OpenAIProvider>[0]['client'] } : {}),
    }),
};
