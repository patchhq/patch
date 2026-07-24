import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, '..');

/** Bundle workspace packages into the published CLI (no workspace:* at install time). */
const workspaceAliases: Record<string, string> = {
  '@patch-dev/core': path.join(packages, 'core/src/index.ts'),
  '@patch-dev/classify': path.join(packages, 'classify/src/index.ts'),
  '@patch-dev/fix': path.join(packages, 'fix/src/index.ts'),
  '@patch-dev/model': path.join(packages, 'model/src/index.ts'),
  '@patch-dev/github-app': path.join(packages, 'github-app/src/index.ts'),
  '@patch-dev/scanner-ts': path.join(packages, 'scanner-ts/src/index.ts'),
  '@patch-dev/scanner-python': path.join(packages, 'scanner-python/src/index.ts'),
  '@patch-dev/scanner-rust': path.join(packages, 'scanner-rust/src/index.ts'),
  '@patch-dev/scanner-go': path.join(packages, 'scanner-go/src/index.ts'),
  '@patch-dev/connector-openapi-diff': path.join(
    packages,
    'connectors/openapi-diff/src/index.ts',
  ),
  '@patch-dev/connector-doc-scrape': path.join(
    packages,
    'connectors/doc-scrape/src/index.ts',
  ),
  '@patch-dev/connector-package-diff': path.join(
    packages,
    'connectors/package-diff/src/index.ts',
  ),
};

const external = [
  '@anthropic-ai/sdk',
  '@octokit/auth-app',
  '@octokit/rest',
  'commander',
  'js-yaml',
  'openai',
  'ts-morph',
  'typescript',
  'zod',
];

export default defineConfig([
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/^@patch-dev\//],
    external,
    esbuildOptions(options) {
      options.alias = { ...options.alias, ...workspaceAliases };
    },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: false,
    // Bin is the product; skip rollup-dts across aliased workspace pkgs.
    dts: false,
    noExternal: [/^@patch-dev\//],
    external,
    esbuildOptions(options) {
      options.alias = { ...options.alias, ...workspaceAliases };
    },
  },
]);
