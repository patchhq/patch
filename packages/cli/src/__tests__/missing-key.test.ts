import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingModelKeyError } from '@patch-dev/model';

/**
 * Scan must surface MissingModelKeyError.message clearly — not an SDK stack.
 * We unit-test the error shape used by runScan's catch path.
 */
describe('missing model key error message', () => {
  const saved = process.env['ANTHROPIC_API_KEY'];

  afterEach(() => {
    if (saved === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = saved;
    vi.restoreAllMocks();
  });

  it('message names the env var and signup URL in one line', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const err = new MissingModelKeyError('anthropic', 'ANTHROPIC_API_KEY');
    expect(err.message).toBe(
      'Missing API key for model provider "anthropic". ' +
        'Set environment variable ANTHROPIC_API_KEY (get a key at https://console.anthropic.com/settings/keys).',
    );
  });
});
