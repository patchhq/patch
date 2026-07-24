/**
 * Hosted backend orchestration (kept closed in production).
 *
 * Open-source CLI already runs the same pipeline via `patch scan`.
 * This process is the multi-tenant scheduler that:
 *  - loads customer connector configs
 *  - runs connectors on a cron
 *  - calls Classify / Fix with the hosted Anthropic key
 *  - opens PRs via the GitHub App installation
 *
 * Self-hosting is possible by pointing this at your own keys —
 * it's intentionally more work than paying for the hosted service.
 */

export interface TenantJob {
  tenantId: string;
  repoUrl: string;
  cron: string;
  configPath: string;
}

const DEFAULT_CRON = '0 */6 * * *'; // every 6 hours — not continuous polling

export function describeScheduler(): string {
  return [
    'Patch hosted scheduler',
    `Default cadence: ${DEFAULT_CRON}`,
    'Pipeline: fetch → diff → classify → scan → fix → validate → PR/Issue',
    'LLM calls (Classify + Fix) run here so API cost + prompt tuning stay centralized.',
  ].join('\n');
}

export function startScheduler(jobs: TenantJob[] = []): void {
  console.log(describeScheduler());
  console.log(`Registered tenants: ${jobs.length}`);
  if (jobs.length === 0) {
    console.log(
      'No tenants configured. Set PATCH_TENANTS_JSON or use the open-source CLI (`npx patch scan`).',
    );
  }
  // MVP: process-local loop placeholder. Production would use a real job queue.
  for (const job of jobs) {
    console.log(`  • ${job.tenantId} — ${job.repoUrl} (${job.cron})`);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('index.js')) {
  let jobs: TenantJob[] = [];
  if (process.env['PATCH_TENANTS_JSON']) {
    jobs = JSON.parse(process.env['PATCH_TENANTS_JSON']) as TenantJob[];
  }
  startScheduler(jobs);
}
