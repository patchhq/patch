import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  detectLanguages,
  findRegistryMatches,
  languageDisplayName,
  writeDefaultRulesFile,
  type ConnectorConfig,
  type PatchConfig,
} from '@patch-dev/core';
import { readGithubAppInstallUrl } from '@patch-dev/github-app';

export interface InitOptions {
  cwd: string;
  yes: boolean;
}

function readPackageDeps(cwd: string): Record<string, string> {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return {};
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function scaffoldWorkflow(cwd: string): string {
  const dir = join(cwd, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'patch.yml');
  const content = `# Patch: scheduled upstream API change scan
name: patch

on:
  schedule:
    # Daily at 14:00 UTC — APIs don't change hourly
    - cron: '0 14 * * *'
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @patch-dev/cli@latest
      - name: Run patch scan
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: patch scan
`;
  writeFileSync(path, content, 'utf8');
  return path;
}

async function confirm(message: string, yesFlag: boolean): Promise<boolean> {
  if (yesFlag) return true;
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [Y/n] `);
    return !answer || /^y/i.test(answer);
  } finally {
    rl.close();
  }
}

export async function runInit(options: InitOptions): Promise<void> {
  const languages = detectLanguages(options.cwd);
  const deps = readPackageDeps(options.cwd);
  const matches = findRegistryMatches(deps);

  console.log('Patch init');
  console.log('----------');

  if (languages.length > 0) {
    console.log(
      `Detected languages: ${languages.map(languageDisplayName).join(', ')}`,
    );
    const unimplemented = languages.filter((l) =>
      ['python', 'rust', 'go'].includes(l),
    );
    if (unimplemented.length > 0) {
      console.log(
        `  (scanners for ${unimplemented.join(', ')} are stubs — see docs/languages.md)`,
      );
    }
    console.log();
  } else {
    console.log(
      'No language markers found (tsconfig.json, pyproject.toml, Cargo.toml, go.mod, …).',
    );
    console.log('Defaulting languages to typescript. Override in patch.config.json.\n');
  }

  if (matches.length === 0) {
    console.log('No known API packages found in package.json.');
    console.log('You can still add connectors manually to patch.config.json.');
    console.log('See docs/connectors.md for the connector registry.');
  } else {
    console.log(`Detected ${matches.length} connector match(es):\n`);
    for (const m of matches) {
      console.log(`  • ${m.packageName} → ${m.connectorId} (${m.type})`);
    }
    console.log();
  }

  const ok = await confirm('Write patch.config.json with these connectors?', options.yes);
  if (!ok) {
    console.log('Aborted.');
    return;
  }

  const connectors: ConnectorConfig[] = matches.map((m) => ({
    id: m.connectorId,
    type: m.type,
    enabled: true,
    import_path: m.defaultImportPath,
    options: m.options,
  }));

  const config: PatchConfig = {
    version: 1,
    confidence_threshold: 0.7,
    snapshot_db: '.patch/snapshots.db',
    languages: languages.length > 0 ? languages : ['typescript'],
    max_fix_attempts: 3,
    rules: [],
    disable_default_rules: [],
    connectors:
      connectors.length > 0
        ? connectors
        : [
            {
              id: 'example-stripe-openapi',
              type: 'openapi-diff',
              enabled: false,
              import_path: 'stripe',
              options: {
                specUrl:
                  'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
              },
            },
          ],
  };

  const configPath = join(options.cwd, 'patch.config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${configPath}`);

  mkdirSync(join(options.cwd, '.patch'), { recursive: true });
  const rulesPath = writeDefaultRulesFile(options.cwd);
  console.log(`Wrote ${rulesPath} (edit to add custom fix-agent rules)`);
  const gitignore = join(options.cwd, '.gitignore');
  if (existsSync(gitignore)) {
    const gi = readFileSync(gitignore, 'utf8');
    if (!gi.includes('.patch/')) {
      writeFileSync(gitignore, `${gi.trimEnd()}\n.patch/\n`, 'utf8');
    }
  }

  const workflow = scaffoldWorkflow(options.cwd);
  console.log(`Scaffolded ${workflow}`);

  const installUrl = readGithubAppInstallUrl();
  console.log();
  console.log('Next step (required — GitHub App installs need a human):');
  console.log(`  Install the Patch GitHub App: ${installUrl}`);
  console.log();
  console.log('Then either wait for the scheduled Action or run:');
  console.log('  npx -y @patch-dev/cli scan');
}
