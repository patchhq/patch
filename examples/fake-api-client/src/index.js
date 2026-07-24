export class FakeApiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  async createCharge(options) {
    return { id: `ch_${options.amount}_${options.currency ?? 'usd'}` };
  }
  async charge(amount) {
    return this.createCharge({ amount });
  }
}

export function createClient(apiKey) {
  return new FakeApiClient(apiKey);
}

export default FakeApiClient;
