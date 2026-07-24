import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelCompleteRequest,
  ModelCompleteResult,
  ModelContentPart,
  ModelMessage,
  ModelProvider,
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

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; model: string; client?: Anthropic }) {
    this.model = options.model;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  }

  async complete(request: ModelCompleteRequest): Promise<ModelCompleteResult> {
    const tools = request.tools?.map((t) => ({
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
