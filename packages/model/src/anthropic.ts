import Anthropic from '@anthropic-ai/sdk';
import { SDK_PLACEHOLDER_KEY, withEndpoint } from './endpoint.js';
import type {
  ModelCapabilities,
  ModelCompleteRequest,
  ModelCompleteResult,
  ModelContentPart,
  ModelMessage,
  ModelProvider,
  ModelProviderId,
  ModelToolCall,
} from './types.js';

function toAnthropicMessages(
  messages: ModelMessage[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled via `system`
    if (msg.role === 'tool') {
      // Tool results are folded into user messages by the fix loop
      continue;
    }
    if (typeof msg.content === 'string') {
      out.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
      continue;
    }
    const parts: Anthropic.ContentBlockParam[] = [];
    for (const part of msg.content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool_use') {
        parts.push({
          type: 'tool_use',
          id: part.id,
          name: part.name,
          input: part.input,
        });
      } else if (part.type === 'tool_result') {
        parts.push({
          type: 'tool_result',
          tool_use_id: part.tool_use_id,
          content: part.content,
          is_error: part.is_error,
        });
      }
    }
    out.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: parts,
    });
  }
  return out;
}

function systemFrom(request: ModelCompleteRequest): string | undefined {
  if (request.system) return request.system;
  const sys = request.messages.find((m) => m.role === 'system');
  if (!sys) return undefined;
  return typeof sys.content === 'string'
    ? sys.content
    : sys.content
        .filter((p): p is Extract<ModelContentPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
}

export interface AnthropicProviderOptions {
  model: string;
  /** Provider id for logs; defaults to 'anthropic'. */
  id?: ModelProviderId;
  /** Endpoint override — a proxy, a gateway, or a local Anthropic-compatible server. */
  baseUrl?: string;
  /** Final header set (auth included). Applied by the endpoint wrapper, not the SDK. */
  headers?: Readonly<Record<string, string>>;
  /** Final query parameters (auth included). */
  query?: Readonly<Record<string, string>>;
  /** May tool definitions be sent? Default true. */
  tools?: boolean;
  /** Test seam: an injected client owns its own transport and auth. */
  client?: Anthropic;
}

export class AnthropicProvider implements ModelProvider {
  readonly id: ModelProviderId;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id ?? 'anthropic';
    this.model = options.model;
    this.capabilities = { tools: options.tools ?? true };
    this.client =
      options.client ??
      new Anthropic({
        // The endpoint wrapper owns the real auth headers; the SDK only needs a non-empty
        // string so it will construct.
        apiKey: SDK_PLACEHOLDER_KEY,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        fetch: withEndpoint({
          headers: options.headers ?? {},
          query: options.query ?? {},
        }),
      });
  }

  async complete(request: ModelCompleteRequest): Promise<ModelCompleteResult> {
    const tools =
      this.capabilities.tools === false
        ? undefined
        : request.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool['input_schema'],
          }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: systemFrom(request),
      messages: toAnthropicMessages(request.messages),
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    const toolCalls: ModelToolCall[] = [];
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') textParts.push(block.text);
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textParts.join('\n'),
      toolCalls,
      raw: response,
    };
  }
}
