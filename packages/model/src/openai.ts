import OpenAI from 'openai';
import type {
  ModelCompleteRequest,
  ModelCompleteResult,
  ModelContentPart,
  ModelMessage,
  ModelProvider,
  ModelToolCall,
} from './types.js';

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

function flattenText(content: string | ModelContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ModelContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function toOpenAIMessages(request: ModelCompleteRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const system = request.system;
  if (system) {
    out.push({ role: 'system', content: system });
  }

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: flattenText(msg.content) });
      continue;
    }

    if (typeof msg.content === 'string') {
      if (msg.role === 'assistant') {
        out.push({ role: 'assistant', content: msg.content });
      } else {
        out.push({ role: 'user', content: msg.content });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const toolCalls = msg.content.filter(
        (p): p is Extract<ModelContentPart, { type: 'tool_use' }> => p.type === 'tool_use',
      );
      const text = flattenText(msg.content);
      if (toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((t) => ({
            id: t.id,
            type: 'function' as const,
            function: {
              name: t.name,
              arguments: JSON.stringify(t.input ?? {}),
            },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: text });
      }
      continue;
    }

    // user message may include tool_result parts after a tool round
    const toolResults = msg.content.filter(
      (p): p is Extract<ModelContentPart, { type: 'tool_result' }> =>
        p.type === 'tool_result',
    );
    const text = flattenText(msg.content);
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }
      if (text) out.push({ role: 'user', content: text });
    } else {
      out.push({ role: 'user', content: text });
    }
  }

  return out;
}

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai' as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: { apiKey: string; model: string; client?: OpenAI }) {
    this.model = options.model;
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
  }

  async complete(request: ModelCompleteRequest): Promise<ModelCompleteResult> {
    const tools = request.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: toOpenAIMessages(request),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.responseSchema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: 'patch_response',
                schema: request.responseSchema,
                strict: false,
              },
            },
          }
        : {}),
    });

    const choice = response.choices[0]?.message;
    const toolCalls: ModelToolCall[] = [];
    for (const tc of choice?.tool_calls ?? []) {
      if (tc.type !== 'function') continue;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        input = { raw: tc.function.arguments };
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }

    return {
      content: choice?.content ?? '',
      toolCalls,
      raw: response,
    };
  }
}
