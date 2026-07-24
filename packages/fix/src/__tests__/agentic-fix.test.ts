import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ChangeEvent, FixInstruction, MatchSite } from '@patch-dev/core';
import { loadRules } from '@patch-dev/core';
import {
  CONFIDENCE_CEILINGS,
  generateAndValidateFix,
  executeReadFile,
  createReadFileState,
  type ProposeFixFn,
  type GeneratedFix,
} from '../index.js';

function makeEvent(overrides?: Partial<ChangeEvent>): ChangeEvent {
  return {
    id: randomUUID(),
    connector_id: 'fixture-fake-api',
    detected_at: new Date().toISOString(),
    type: 'added_required_param',
    surface: { kind: 'method', path: 'FakeApiClient.createCharge' },
    old: { signature: 'createCharge({ amount })' },
    new: { signature: 'createCharge({ amount, currency })' },
    source_excerpt: 'currency is now required',
    confidence: 0.9,
    ...overrides,
  };
}

function makeInstruction(eventId: string): FixInstruction {
  return {
    change_event_id: eventId,
    match_pattern: {
      import_path: '@fixture/fake-api-client',
      symbol: 'createCharge',
      language: 'typescript',
    },
    transform: {
      kind: 'change_param',
      instructions: 'Add required currency parameter',
    },
  };
}

function scaffoldRepo(dir: string, consumerSource: string): MatchSite {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'agentic-fixture',
        private: true,
        type: 'module',
        scripts: {},
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'types.d.ts'),
    `
export interface ChargeOptions {
  amount: number;
  currency: string;
}
export declare function createCharge(options: ChargeOptions): Promise<{ id: string }>;
`,
  );
  writeFileSync(join(dir, 'src', 'consumer.ts'), consumerSource);
  writeFileSync(
    join(dir, 'src', 'helper.ts'),
    `export const DEFAULT_CURRENCY = 'usd';\n`,
  );

  const lines = consumerSource.split('\n');
  const line =
    lines.findIndex((l) => l.includes('createCharge')) + 1 || 1;
  return {
    file: 'src/consumer.ts',
    line,
    column: 0,
    snippet: lines[line - 1] ?? '',
    language: 'typescript',
  };
}

describe('agentic fix loop', () => {
  let dir: string;
  const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-agentic-'));
    logs.length = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('retries after tsc failure and succeeds on attempt 2', async () => {
    const site = scaffoldRepo(
      dir,
      `import { createCharge } from './types.js';\nexport async function run() {\n  return createCharge({ amount: 10 });\n}\n`,
    );
    const event = makeEvent();
    const instruction = makeInstruction(event.id);

    let calls = 0;
    const proposeFix: ProposeFixFn = async () => {
      calls += 1;
      if (calls === 1) {
        // Broken: missing required currency — will fail tsc
        return {
          before: 'return createCharge({ amount: 10 });',
          after: 'return createCharge({ amount: 10 });',
          confidence: 0.95,
          rationale: 'no-op first attempt',
        } satisfies GeneratedFix;
      }
      return {
        before: 'return createCharge({ amount: 10 });',
        after: "return createCharge({ amount: 10, currency: 'usd' });",
        confidence: 0.92,
        rationale: 'added currency after seeing tsc error',
      };
    };

    const result = await generateAndValidateFix(event, instruction, site, {
      repoRoot: dir,
      proposeFix,
      maxAttempts: 3,
      log: (message, data) => logs.push({ message, data }),
    });

    expect(calls).toBe(2);
    expect(result.observability.attempts).toBe(2);
    expect(result.observability.passedOnAttempt).toBe(2);
    expect(result.typecheckPassed).toBe(true);
    expect(result.confidence).toBeGreaterThan(CONFIDENCE_CEILINGS.typecheckFailed);
    // Attempt count must not drag confidence down — validation ceiling only
    expect(result.confidence).toBe(
      Math.min(0.92, CONFIDENCE_CEILINGS.typecheckOnly),
    );

    const firstAttempt = result.observability.attemptLog[0]!;
    expect(firstAttempt.validationPassed).toBe(false);
    expect(firstAttempt.failedStage).toBe('typecheck');
    expect(firstAttempt.errorOutput.length).toBeGreaterThan(0);
    expect(firstAttempt.errorOutput).toMatch(/currency|ChargeOptions|error TS/i);

    expect(logs.some((l) => l.message === 'fix attempt starting')).toBe(true);
    expect(logs.some((l) => l.message === 'fix loop complete')).toBe(true);
  }, 60_000);

  it('falls back to low-confidence Issue path after 3 failed attempts', async () => {
    const site = scaffoldRepo(
      dir,
      `import { createCharge } from './types.js';\nexport async function run() {\n  return createCharge({ amount: 10 });\n}\n`,
    );
    const event = makeEvent();
    const instruction = makeInstruction(event.id);

    let calls = 0;
    const proposeFix: ProposeFixFn = async () => {
      calls += 1;
      // Always leave currency missing — never typechecks
      return {
        before: 'return createCharge({ amount: 10 });',
        after: `return createCharge({ amount: ${10 + calls} });`,
        confidence: 0.99,
        rationale: `bad attempt ${calls}`,
      };
    };

    const result = await generateAndValidateFix(event, instruction, site, {
      repoRoot: dir,
      proposeFix,
      maxAttempts: 3,
      log: (message, data) => logs.push({ message, data }),
    });

    expect(calls).toBe(3);
    expect(result.observability.attempts).toBe(3);
    expect(result.observability.passedOnAttempt).toBeNull();
    expect(result.typecheckPassed).toBe(false);
    // Low confidence → Issue path (below default 0.7 threshold)
    expect(result.confidence).toBeLessThanOrEqual(
      CONFIDENCE_CEILINGS.typecheckFailed,
    );
    expect(result.confidence).toBe(CONFIDENCE_CEILINGS.typecheckFailed);

    // Did not loop further
    expect(result.observability.attemptLog).toHaveLength(3);
    expect(
      logs.filter((l) => l.message === 'fix attempt starting'),
    ).toHaveLength(3);
  }, 90_000);

  it('caps read_file at 3 per attempt and records paths', async () => {
    scaffoldRepo(
      dir,
      `import { createCharge } from './types.js';\nexport async function run() {\n  return createCharge({ amount: 10, currency: 'usd' });\n}\n`,
    );
    const state = createReadFileState();
    const a = executeReadFile(dir, 'src/helper.ts', state, 3);
    const b = executeReadFile(dir, 'src/types.d.ts', state, 3);
    const c = executeReadFile(dir, 'src/consumer.ts', state, 3);
    const d = executeReadFile(dir, 'src/helper.ts', state, 3);

    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/limit reached/);
    expect(state.reads).toBe(3);
    expect(state.paths).toEqual([
      'src/helper.ts',
      'src/types.d.ts',
      'src/consumer.ts',
    ]);

    // Path traversal blocked
    const escape = executeReadFile(dir, '../secrets.txt', createReadFileState(), 3);
    expect(escape.ok).toBe(false);
  });

  it('loads default rules for the repo', () => {
    const rules = loadRules(dir);
    expect(rules.some((r) => r.id === 'after-fix-typecheck')).toBe(true);
    expect(rules.some((r) => r.id === 'bounded-retries')).toBe(true);
  });
});

describe('read_file during propose', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-read-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('proposeFix can use read_file state and paths are logged', async () => {
    const site = scaffoldRepo(
      dir,
      `import { createCharge } from './types.js';\nexport async function run() {\n  return createCharge({ amount: 1 });\n}\n`,
    );
    const event = makeEvent();
    const instruction = makeInstruction(event.id);
    const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];

    const proposeFix: ProposeFixFn = async (ctx) => {
      const read = executeReadFile(ctx.repoRoot, 'src/helper.ts', ctx.readState, 3);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.content).toContain('DEFAULT_CURRENCY');
      }
      return {
        before: 'return createCharge({ amount: 1 });',
        after: "return createCharge({ amount: 1, currency: 'usd' });",
        confidence: 0.8,
        rationale: 'used helper context',
      };
    };

    const result = await generateAndValidateFix(event, instruction, site, {
      repoRoot: dir,
      proposeFix,
      maxAttempts: 1,
      log: (message, data) => logs.push({ message, data }),
    });

    expect(result.observability.totalFileReads).toBe(1);
    expect(result.observability.fileReadPaths).toContain('src/helper.ts');
    expect(result.typecheckPassed).toBe(true);
    void readFileSync;
  }, 60_000);
});
