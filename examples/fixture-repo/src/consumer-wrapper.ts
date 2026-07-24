/** Import via local re-export wrapper */
import { createClient } from './wrapper.js';

export async function chargeViaWrapper(apiKey: string, amount: number) {
  const client = createClient(apiKey);
  return client.createCharge({ amount });
}
