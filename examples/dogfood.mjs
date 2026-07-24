#!/usr/bin/env node
/**
 * End-to-end dogfood: baseline → break ChargeOptions.currency → patch scan --dry-run.
 *
 * Usage (from repo root, after `pnpm build`):
 *   node examples/dogfood.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'examples/fake-api-client');
const fixtureDir = join(root, 'examples/fixture-repo');
const cliBin = join(root, 'packages/cli/dist/bin.js');

const DTS_V1 = `/** Fake upstream API client used by the fixture repo. */
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
`;

const DTS_V11 = `/** Fake upstream API client used by the fixture repo. */
export interface ChargeOptions {
  amount: number;
  /** Required as of v1.1.0 (breaking change from optional in v1.0). */
  currency: string;
}

export declare class FakeApiClient {
  constructor(apiKey: string);
  createCharge(options: ChargeOptions): Promise<{ id: string }>;
  /** @deprecated use createCharge */
  charge(amount: number): Promise<{ id: string }>;
}

export declare function createClient(apiKey: string): FakeApiClient;

export default FakeApiClient;
`;

function setApiVersion(version, dts) {
  writeFileSync(join(apiDir, 'src/index.d.ts'), dts);
  const pkgPath = join(apiDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function runScan() {
  const result = spawnSync(process.execPath, [cliBin, 'scan', '--dry-run'], {
    cwd: fixtureDir,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`patch scan exited ${result.status}`);
  }
}

function main() {
  if (!existsSync(cliBin)) {
    console.error('Missing CLI build. Run: pnpm --filter @patch-dev/cli build');
    process.exit(1);
  }

  console.log('═══ Patch dogfood ═══\n');
  console.log('1) Reset fixture snapshot + baseline at fake-api-client@1.0.0');
  rmSync(join(fixtureDir, '.patch'), { recursive: true, force: true });
  mkdirSync(join(fixtureDir, '.patch'), { recursive: true });
  setApiVersion('1.0.0', DTS_V1);
  runScan();

  console.log('\n2) Break upstream: currency required (1.1.0)');
  setApiVersion('1.1.0', DTS_V11);
  writeFileSync(
    join(apiDir, 'CHANGELOG.md'),
    `# Changelog

## 1.1.0

**Breaking:** \`ChargeOptions.currency\` is now required (was optional in 1.0.0).

## 1.0.0

- Initial release: \`createCharge\`, \`charge\`, \`createClient\`
`,
  );

  console.log('\n3) Scan (expect createCharge sites + dry-run report)');
  runScan();

  console.log('\n4) Restore resting fake-api-client@1.0.0');
  setApiVersion('1.0.0', DTS_V1);
  writeFileSync(
    join(apiDir, 'CHANGELOG.md'),
    `# Changelog

## 1.0.0

- Initial release: \`createCharge\`, \`charge\`, \`createClient\`

To simulate an upstream break, see \`examples/dogfood.md\` (or run \`node examples/dogfood.mjs\`).
`,
  );

  console.log('\nDone. Reports under examples/fixture-repo/.patch/reports/');
}

main();
