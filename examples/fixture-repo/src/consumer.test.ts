import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chargeWithNamed } from './consumer-named.js';

describe('fixture consumers', () => {
  it('createCharge returns an id', async () => {
    const result = await chargeWithNamed('test-key', 100);
    assert.ok(result.id.startsWith('ch_'));
  });
});
