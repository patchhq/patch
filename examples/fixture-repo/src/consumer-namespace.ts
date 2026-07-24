/** Namespace import style */
import * as FakeApi from '@fixture/fake-api-client';

export async function chargeWithNamespace(apiKey: string, amount: number) {
  const client = FakeApi.createClient(apiKey);
  return client.createCharge({ amount });
}
