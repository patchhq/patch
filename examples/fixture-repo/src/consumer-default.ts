/** Default import style */
import FakeApiClient from '@fixture/fake-api-client';

export async function chargeWithDefault(apiKey: string, amount: number) {
  const client = new FakeApiClient(apiKey);
  return client.createCharge({ amount });
}
