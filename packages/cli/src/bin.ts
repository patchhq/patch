import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runScan } from './commands/scan.js';

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const version = readVersion();

const program = new Command();

program
  .name('patch')
  .description('Detect upstream API breaking changes and open PRs to fix your codebase')
  .version(version);

program
  .command('init')
  .description('Detect API deps, write patch.config.json, scaffold GitHub Action')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(async (opts: { yes: boolean; cwd: string }) => {
    await runInit({ yes: opts.yes, cwd: opts.cwd });
  });

program
  .command('scan')
  .description('Fetch connectors, classify changes, scan code, open PR or Issue')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .option('--dry-run', 'Do not open GitHub PRs/issues; write local reports', false)
  .action(async (opts: { cwd: string; dryRun: boolean }) => {
    await runScan({ cwd: opts.cwd, dryRun: opts.dryRun });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
