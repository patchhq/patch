import type { ConnectorRegistryEntry } from './connector.js';

/**
 * Static registry used by `patch init` to map package.json deps → connectors.
 * Extend this as new certified connectors are added.
 */
export const CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [
  {
    packageName: 'openai',
    connectorId: 'openai-node-sdk',
    type: 'package-diff',
    defaultImportPath: 'openai',
    options: {
      package: 'openai',
      registry: 'npm',
    },
  },
  {
    packageName: 'stripe',
    connectorId: 'stripe-openapi',
    type: 'openapi-diff',
    defaultImportPath: 'stripe',
    options: {
      specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
    },
  },
  {
    packageName: '@octokit/rest',
    connectorId: 'github-rest-docs',
    type: 'doc-scrape',
    defaultImportPath: '@octokit/rest',
    options: {
      urls: ['https://docs.github.com/en/rest/overview/about-githubs-apis'],
      similarityThreshold: 0.85,
    },
  },
  {
    packageName: 'ethers',
    connectorId: 'ethers-sdk',
    type: 'package-diff',
    defaultImportPath: 'ethers',
    options: {
      package: 'ethers',
      registry: 'npm',
    },
  },
  {
    packageName: '@fixture/fake-api-client',
    connectorId: 'fixture-fake-api',
    type: 'package-diff',
    defaultImportPath: '@fixture/fake-api-client',
    options: {
      package: '@fixture/fake-api-client',
      registry: 'npm',
      localPath: '../fake-api-client',
    },
  },
];

export function findRegistryMatches(
  dependencies: Record<string, string>,
): ConnectorRegistryEntry[] {
  const names = new Set(Object.keys(dependencies));
  return CONNECTOR_REGISTRY.filter((entry) => names.has(entry.packageName));
}
