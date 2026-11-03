import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  InvalidModelConfigError,
  ModelConfigSchema,
  assertModelKeyPresent,
  createModelProvider,
  describeModel,
  resolveModelConfig,
  serializeModelConfig,
  type ModelConfig,
} from '../index.js';
import { withEndpoint } from '../endpoint.js';


/** ZodError.message is a JSON dump; assert on the issue text a human actually reads. */
function issues(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (err) {
    if (err instanceof z.ZodError) return err.issues.map((i) => i.message).join('\n');
    throw err;
  }
}

const AZURE: ModelConfig = ModelConfigSchema.parse({
  provider: 'azure-acme',
  dialect: 'openai',
  base_url: 'https://acme.openai.azure.com/openai/deployments/gpt-4o',
  model: 'gpt-4o',
  api_key_env: 'AZURE_OPENAI_API_KEY',
  auth: { scheme: 'header', name: 'api-key' },
  query: { 'api-version': '2024-10-21' },
});

const OLLAMA: ModelConfig = ModelConfigSchema.parse({
  provider: 'ollama',
  dialect: 'openai',
  base_url: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5-coder:32b',
  auth: { scheme: 'none' },
});

describe('custom provider config', () => {
  it('keeps a built-in config byte-identical in shape', () => {
    expect(ModelConfigSchema.parse({})).toEqual({
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('resolves a custom endpoint without re-deriving anything downstream', () => {
    const resolved = resolveModelConfig(AZURE);
    expect(resolved).toMatchObject({
      provider: 'azure-acme',
      dialect: 'openai',
      model: 'gpt-4o',
      apiKeyEnv: 'AZURE_OPENAI_API_KEY',
      auth: { scheme: 'header', name: 'api-key' },
      query: { 'api-version': '2024-10-21' },
      tools: true,
    });
    expect(resolved.baseUrl).toBe(AZURE.base_url);
  });

  it('treats a local keyless endpoint as first class', () => {
    const resolved = resolveModelConfig(OLLAMA);
    expect(resolved.apiKeyEnv).toBeUndefined();
    expect(assertModelKeyPresent(OLLAMA)).toBeUndefined();

    const provider = createModelProvider({ config: OLLAMA });
    expect(provider.id).toBe('ollama');
    expect(provider.model).toBe('qwen2.5-coder:32b');
    expect(provider.capabilities).toEqual({ tools: true });
  });

  it('carries tools:false through to the provider capability', () => {
    const config = ModelConfigSchema.parse({
      ...AZURE,
      tools: false,
    });
    expect(createModelProvider({ config, apiKey: 'k' }).capabilities).toEqual({
      tools: false,
    });
  });

  it('requires dialect, base_url and model for a custom provider', () => {
    expect(issues(() => ModelConfigSchema.parse({ provider: 'my-gateway' }))).toMatch(
      /needs "dialect"/,
    );
    expect(
      issues(() => ModelConfigSchema.parse({ provider: 'my-gateway', dialect: 'openai' })),
    ).toMatch(/base_url is required/);
    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'my-gateway',
          dialect: 'openai',
          base_url: 'https://g/v1',
        }),
      ),
    ).toMatch(/model.model is required/);
  });

  it('rejects a built-in provider that claims the other dialect', () => {
    expect(
      issues(() => ModelConfigSchema.parse({ provider: 'openai', dialect: 'anthropic' })),
    ).toMatch(/speaks the "openai" dialect/);
  });

  it('rejects contradictory or incomplete auth', () => {
    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'ollama',
          dialect: 'openai',
          base_url: 'http://127.0.0.1:11434/v1',
          model: 'llama3.2',
          api_key_env: 'SOME_KEY',
          auth: { scheme: 'none' },
        }),
      ),
    ).toMatch(/api_key_env is set but model.auth.scheme is "none"/);

    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'azure',
          dialect: 'openai',
          base_url: 'https://acme.openai.azure.com/v1',
          model: 'gpt-4o',
          api_key_env: 'AZURE_KEY',
          auth: { scheme: 'header' },
        }),
      ),
    ).toMatch(/auth.name is required/);

    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'gateway',
          dialect: 'openai',
          base_url: 'https://gateway.internal/v1',
          model: 'gpt-4o-mini',
        }),
      ),
    ).toMatch(/needs "api_key_env"/);
  });

  it('rejects credentials smuggled into config', () => {
    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'gateway',
          dialect: 'openai',
          base_url: 'https://user:pass@gateway.internal/v1',
          model: 'gpt-4o-mini',
          api_key_env: 'GATEWAY_KEY',
        }),
      ),
    ).toMatch(/must not embed credentials/);

    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'gateway',
          dialect: 'openai',
          base_url: 'https://gateway.internal/v1',
          model: 'gpt-4o-mini',
          api_key_env: 'GATEWAY_KEY',
          headers: { Authorization: 'Bearer whatever' },
        }),
      ),
    ).toMatch(/must not carry the credential header/);

    expect(
      issues(() =>
        ModelConfigSchema.parse({
          provider: 'gateway',
          dialect: 'openai',
          base_url: 'https://gateway.internal/v1',
          model: 'gpt-4o-mini',
          api_key_env: 'GATEWAY_KEY',
          headers: { 'x-key': 'sk-abcdefghijklmnopqrstuvwxyz0123' },
        }),
      ),
    ).toMatch(/Refusing to use config/);
  });

  it('rejects unknown fields so typos fail loudly', () => {
    expect(issues(() => ModelConfigSchema.parse({ provider: 'openai', baseUrl: 'x' }))).toMatch(
      /Unrecognized key/,
    );
  });
});

describe('describeModel', () => {
  it('renders built-ins without endpoint noise', () => {
    expect(describeModel(ModelConfigSchema.parse({}))).toBe(
      'anthropic (claude-sonnet-4-20250514) via $ANTHROPIC_API_KEY',
    );
  });

  it('names a custom endpoint but never prints query values or credentials', () => {
    const line = describeModel(
      ModelConfigSchema.parse({
        ...AZURE,
        query: { 'api-version': '2024-10-21', token: 'super-secret' },
      }),
    );
    expect(line).toContain('azure-acme (gpt-4o)');
    expect(line).toContain('[openai dialect]');
    expect(line).toContain('via $AZURE_OPENAI_API_KEY');
    expect(line).not.toContain('super-secret');
    expect(line).not.toContain('api-version');
  });

  it('says so when there is no key and when tools are off', () => {
    const line = describeModel(
      ModelConfigSchema.parse({ ...OLLAMA, tools: false }),
    );
    expect(line).toContain('no api key');
    expect(line).toContain('tools disabled');
  });
});

describe('serializeModelConfig', () => {
  it('round-trips a built-in to exactly the three written keys', () => {
    const parsed = ModelConfigSchema.parse({});
    const serialized = serializeModelConfig(parsed);
    expect(serialized).toEqual({
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-20250514',
    });
    expect(ModelConfigSchema.parse(serialized)).toEqual(parsed);
    // Key order matters: `patch init --yes` must not churn existing config files.
    expect(Object.keys(serialized)).toEqual(['provider', 'api_key_env', 'model']);
  });

  it('round-trips a custom endpoint, keyless included', () => {
    expect(ModelConfigSchema.parse(serializeModelConfig(AZURE))).toEqual(AZURE);
    expect(ModelConfigSchema.parse(serializeModelConfig(OLLAMA))).toEqual(OLLAMA);
  });
});

describe('withEndpoint', () => {
  it('owns auth headers and appends configured query parameters', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const stub = (async (input: unknown, init?: unknown) => {
      seenUrl = String(input);
      const headers = new Headers((init as RequestInit).headers);
      seenHeaders = Object.fromEntries(headers.entries());
      return new Response('{}');
    }) as unknown as typeof fetch;

    const wrapped = withEndpoint(
      { headers: { authorization: 'Bearer real-key' }, query: { 'api-version': '2024-10-21' } },
      stub,
    );
    await wrapped('https://gateway.internal/v1/chat/completions?stream=false', {
      headers: { authorization: 'Bearer patch-no-key', 'content-type': 'application/json' },
    });

    expect(seenUrl).toContain('api-version=2024-10-21');
    expect(seenUrl).toContain('stream=false');
    expect(seenHeaders['authorization']).toBe('Bearer real-key');
    expect(seenHeaders['content-type']).toBe('application/json');
  });

  it('sends no credential header for a keyless endpoint', async () => {
    let seenHeaders: Record<string, string> = {};
    const stub = (async (_input: unknown, init?: unknown) => {
      seenHeaders = Object.fromEntries(new Headers((init as RequestInit).headers).entries());
      return new Response('{}');
    }) as unknown as typeof fetch;

    await withEndpoint({ headers: {}, query: {} }, stub)('http://127.0.0.1:11434/v1/models', {
      headers: { authorization: 'Bearer patch-no-key', 'x-api-key': 'patch-no-key' },
    });

    expect(seenHeaders['authorization']).toBeUndefined();
    expect(seenHeaders['x-api-key']).toBeUndefined();
  });
});

describe('custom provider error paths', () => {
  const saved = process.env['AZURE_OPENAI_API_KEY'];
  afterEach(() => {
    if (saved === undefined) delete process.env['AZURE_OPENAI_API_KEY'];
    else process.env['AZURE_OPENAI_API_KEY'] = saved;
  });

  it('fails before SDK construction when the named env var is unset', () => {
    delete process.env['AZURE_OPENAI_API_KEY'];
    expect(() => createModelProvider({ config: AZURE })).toThrow(
      /Set environment variable AZURE_OPENAI_API_KEY/,
    );
    // A custom endpoint has no signup page to point at.
    expect(() => createModelProvider({ config: AZURE })).not.toThrow(/undefined/);
  });

  it('reports a missing key id in the provider field, not as an undefined URL', () => {
    delete process.env['AZURE_OPENAI_API_KEY'];
    try {
      createModelProvider({ config: AZURE });
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('"azure-acme"');
      expect((err as Error).message).not.toContain('undefined');
    }
  });

  it('throws InvalidModelConfigError for a config the schema let through', () => {
    expect(() =>
      resolveModelConfig({ provider: 'half-built', model: undefined } as ModelConfig),
    ).toThrow(InvalidModelConfigError);
  });
});
