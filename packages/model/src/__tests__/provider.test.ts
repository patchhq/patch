import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelConfigSchema,
  MissingModelKeyError,
  assertModelKeyPresent,
  assertNoEmbeddedSecrets,
  createModelProvider,
  DEFAULT_MODEL_CONFIG,
} from '../index.js';

describe('ModelConfigSchema', () => {
  it('defaults to anthropic + ANTHROPIC_API_KEY', () => {
    expect(ModelConfigSchema.parse({})).toEqual({
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('defaults openai env + model when provider is openai', () => {
    expect(ModelConfigSchema.parse({ provider: 'openai' })).toEqual({
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
      model: 'gpt-4o',
    });
  });
});

describe('assertNoEmbeddedSecrets', () => {
  it('allows provider + api_key_env only', () => {
    expect(() =>
      assertNoEmbeddedSecrets({
        provider: 'anthropic',
        api_key_env: 'ANTHROPIC_API_KEY',
      }),
    ).not.toThrow();
  });

  it('rejects Anthropic-shaped keys in config', () => {
    expect(() =>
      assertNoEmbeddedSecrets({
        provider: 'anthropic',
        api_key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    ).toThrow(/Refusing to use config/);
  });

  it('rejects OpenAI-shaped keys in config', () => {
    expect(() =>
      assertNoEmbeddedSecrets({
        provider: 'openai',
        api_key: 'sk-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    ).toThrow(/Refusing to use config/);
  });
});

describe('assertModelKeyPresent / createModelProvider', () => {
  const savedAnthropic = process.env['ANTHROPIC_API_KEY'];
  const savedOpenAI = process.env['OPENAI_API_KEY'];

  afterEach(() => {
    if (savedAnthropic === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedAnthropic;
    if (savedOpenAI === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedOpenAI;
  });

  it('throws one clear MissingModelKeyError when key is absent', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const config = DEFAULT_MODEL_CONFIG;
    expect(() => assertModelKeyPresent(config)).toThrow(MissingModelKeyError);
    try {
      assertModelKeyPresent(config);
    } catch (err) {
      expect(err).toBeInstanceOf(MissingModelKeyError);
      const msg = (err as MissingModelKeyError).message;
      expect(msg).toContain('ANTHROPIC_API_KEY');
      expect(msg).toContain('console.anthropic.com');
      expect(msg).not.toMatch(/at Object\.|node_modules/);
    }
  });

  it('createModelProvider fails before SDK construction when key missing', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() =>
      createModelProvider({
        config: ModelConfigSchema.parse({ provider: 'openai' }),
      }),
    ).toThrow(MissingModelKeyError);
  });

  it('createModelProvider builds anthropic provider when key present', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key-not-real-abcdefghijklmnop';
    const provider = createModelProvider({
      config: DEFAULT_MODEL_CONFIG,
      apiKey: 'sk-ant-test-key-not-real-abcdefghijklmnop',
    });
    expect(provider.id).toBe('anthropic');
    expect(provider.model).toBe('claude-sonnet-4-20250514');
  });

  it('createModelProvider builds openai provider when key present', () => {
    const provider = createModelProvider({
      config: ModelConfigSchema.parse({ provider: 'openai' }),
      apiKey: 'sk-test-key-not-real-abcdefghijklmnop',
    });
    expect(provider.id).toBe('openai');
    expect(provider.model).toBe('gpt-4o');
  });
});
