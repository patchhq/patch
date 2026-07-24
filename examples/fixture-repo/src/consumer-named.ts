/** Named import style */
import { createClient, FakeApiClient } from '@fixture/fake-api-client';

export async function chargeWithNamed(apiKey: string, amount: number) {
  const client: FakeApiClient = createClient(apiKey);
  return client.createCharge({ amount, currency: 'usd' });
}
