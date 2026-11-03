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
import {
  BUILTIN_PROVIDERS,
  ModelConfigSchema,
  describeModel,
  keySignupUrl,
  readApiKeyFromEnv,
  resolveModelConfig,
  serializeModelConfig,
  type ModelConfig,
} from '@patch-dev/model';
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

function scaffoldWorkflow(cwd: string, apiKeyEnv?: string): string {
  const dir = join(cwd, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'patch.yml');
  // Keyless endpoints need no secret, so the env line and its secret are omitted entirely.
  const modelEnvLine = apiKeyEnv
    ? `          ${apiKeyEnv}: \${{ secrets.${apiKeyEnv} }}\n`
    : '';
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
      - name: Create GitHub App token
        id: app-token
        continue-on-error: true
        uses: actions/create-github-app-token@v1
        with:
          app-id: \${{ secrets.PATCH_GITHUB_APP_ID }}
          private-key: \${{ secrets.PATCH_GITHUB_APP_PRIVATE_KEY }}
      - run: npm install -g @patch-dev/cli@latest
      - name: Run patch scan
        env:
${modelEnvLine}          # Prefer App token when the previous step succeeded; else workflow GITHUB_TOKEN
          GITHUB_TOKEN: \${{ steps.app-token.outputs.token || secrets.GITHUB_TOKEN }}
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

/**
 * Interactive provider choice.
 *
 * Built-in entries come from `BUILTIN_PROVIDERS`, so a new built-in is one row, not a new
 * prompt branch. The last two entries are the custom-endpoint escape hatch; they are reachable
 * only from a TTY, which keeps `--yes` and CI runs byte-identical to before.
 */
async function chooseModelConfig(yesFlag: boolean): Promise<ModelConfig> {
  if (yesFlag || !process.stdin.isTTY) {
    return ModelConfigSchema.parse({});
  }

  const rl = createInterface({ input, output });
  try {
    console.log('Which LLM provider should Patch use for classify + fix?');
    BUILTIN_PROVIDERS.forEach((p, i) => {
      console.log(`  ${i + 1}) ${p.label} — env ${p.defaultApiKeyEnv}`);
    });
    const openaiOption = BUILTIN_PROVIDERS.length + 1;
    const anthropicOption = BUILTIN_PROVIDERS.length + 2;
    console.log(
      `  ${openaiOption}) Custom — OpenAI-compatible endpoint (gateway, Azure, Ollama, vLLM, proxy)`,
    );
    console.log(`  ${anthropicOption}) Custom — Anthropic-compatible endpoint`);

    const answer = (
      await rl.question(`Provider [1-${anthropicOption}] (default 1): `)
    ).trim();
    const choice = Number(answer || '1');

    const builtin = BUILTIN_PROVIDERS[choice - 1];
    if (builtin && choice >= 1) {
      return ModelConfigSchema.parse({ provider: builtin.id });
    }
    if (choice !== openaiOption && choice !== anthropicOption) {
      throw new Error(`Invalid provider choice: ${answer}. Run \`patch init\` again.`);
    }

    const dialect = choice === openaiOption ? 'openai' : 'anthropic';
    const baseUrl = (
      await rl.question('Base URL (e.g. https://gateway.internal/v1): ')
    ).trim();
    const modelId = (await rl.question('Model id: ')).trim();
    const apiKeyEnv = (
      await rl.question('Env var holding the API key (blank = no key needed): ')
    ).trim();
    const providerId = (
      await rl.question(`Provider id, used in logs [custom-${dialect}]: `)
    ).trim();

    return ModelConfigSchema.parse({
      provider: providerId || `custom-${dialect}`,
      dialect,
      base_url: baseUrl,
      model: modelId,
      ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : { auth: { scheme: 'none' } }),
    });
  } finally {
    rl.close();
  }
}

function printKeySetup(model: ModelConfig): void {
  const resolved = resolveModelConfig(model);
  if (!resolved.apiKeyEnv) {
    console.log('\nThis endpoint takes no API key — nothing to set.');
    return;
  }
  const { provider, apiKeyEnv } = resolved;
  if (readApiKeyFromEnv(apiKeyEnv)) {
    console.log(`Found $${apiKeyEnv} in the environment.`);
    return;
  }
  console.log();
  console.log(`${apiKeyEnv} is not set.`);
  console.log('Set it before running `patch scan`:');
  console.log(`  export ${apiKeyEnv}=your-key-here`);
  const signup = keySignupUrl(provider);
  if (signup) console.log(`Get a key at ${signup}`);
  console.log(
    '(Never put the key in patch.config.json — only the env var name belongs there.)',
  );
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

  const model = await chooseModelConfig(options.yes);

  const connectors: ConnectorConfig[] = matches.map((m) => ({
    id: m.connectorId,
    type: m.type,
    enabled: true,
    import_path: m.defaultImportPath,
    options: m.options,
  }));

  // Dependabot-style npm dependency + security updates (enabled by default when package.json exists).
  if (existsSync(join(options.cwd, 'package.json'))) {
    connectors.push({
      id: 'npm-dependency-updates',
      type: 'dependency-update',
      enabled: true,
      import_path: '*',
      options: {
        includeDevDependencies: false,
        updateTypes: ['patch', 'minor'],
        deny: [],
      },
    });
  }

  const config: PatchConfig = {
    version: 1,
    confidence_threshold: 0.7,
    snapshot_db: '.patch/snapshots.db',
    languages: languages.length > 0 ? languages : ['typescript'],
    max_fix_attempts: 3,
    rules: [],
    disable_default_rules: [],
    model,
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

  // Persist the model section as written intent: no derived keys, no secrets.
  const configForDisk = {
    ...config,
    model: serializeModelConfig(model),
  };

  const configPath = join(options.cwd, 'patch.config.json');
  writeFileSync(configPath, `${JSON.stringify(configForDisk, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${configPath}`);
  console.log(`Model provider: ${describeModel(model)}`);
  printKeySetup(model);

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

  const workflow = scaffoldWorkflow(options.cwd, resolveModelConfig(model).apiKeyEnv);
  console.log(`Scaffolded ${workflow}`);

  const installUrl = readGithubAppInstallUrl();
  const secrets = [
    resolveModelConfig(model).apiKeyEnv,
    'PATCH_GITHUB_APP_ID',
    'PATCH_GITHUB_APP_PRIVATE_KEY',
  ].filter((s): s is string => Boolean(s));
  console.log();
  console.log('Next steps:');
  console.log(`  1. Install the Patch GitHub App on this repo: ${installUrl}`);
  console.log('     (create the App once — see docs/github-app.md)');
  console.log(`  2. Add secrets: ${secrets.join(', ')}`);
  console.log('  3. Wait for the scheduled Action or run:');
  console.log('       npx patch scan');
}
