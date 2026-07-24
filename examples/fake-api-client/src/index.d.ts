/** Fake upstream API client used by the fixture repo. */
export interface ChargeOptions {
  amount: number;
  /** Optional in v1.0 — becomes required in v1.1 (simulate upstream break). */
  currency?: string;
}

export declare class FakeApiClient {
  constructor(apiKey: string);
  createCharge(options: ChargeOptions): Promise<{ id: string }>;
  /** @deprecated use createCharge */
  charge(amount: number): Promise<{ id: string }>;
}

export declare function createClient(apiKey: string): FakeApiClient;

export default FakeApiClient;
