import type { RawChange, RawSource } from './schemas.js';

/**
 * Every connector — OpenAPI, doc-scrape, or package/SDK — implements this.
 * Downstream stages (Classify, Scan, Fix, PR) must not special-case connector types.
 */
export interface Connector {
  /** Stable id, e..g. "openai-node-sdk" or "stripe-openapi". */
  readonly id: string;

  /** Human-readable name for CLI output and PR descriptions. */
  readonly name: string;

  /** Fetch the latest upstream source (spec, docs page, or package metadata). */
  fetchRaw(): Promise<RawSource>;

  /**
   * Diff previous vs current. Return [] if nothing meaningful changed.
   * previous is null on first run (no snapshot yet).
   */
  diff(previous: RawSource | null, current: RawSource): Promise<RawChange[]> | RawChange[];
}

/** Registry entry used by `patch init` to map package.json deps → connectors. */
export interface ConnectorRegistryEntry {
  /** npm / package name to match in package.json dependencies. */
  packageName: string;
  /** Connector factory id / config key. */
  connectorId: string;
  /** Which connector implementation to use. */
  type: 'openapi-diff' | 'doc-scrape' | 'package-diff';
  /** Connector-specific options written into patch.config.json. */
  options: Record<string, unknown>;
  /** Import path consumers typically use (for FixInstruction mapping). */
  defaultImportPath: string;
}
