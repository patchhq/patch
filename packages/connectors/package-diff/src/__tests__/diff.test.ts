import { describe, it, expect } from 'vitest';
import { extractDeclarations, diffDeclarations } from '../index.js';

const BEFORE = `
export interface Client {
  createCharge(amount: number): Promise<string>;
  currency?: string;
}
export declare function helper(x: string): void;
`;

const AFTER = `
export interface Client {
  createCharge(amount: number, currency: string): Promise<string>;
  currency: string;
}
export declare function helper(x: string): void;
export declare function refund(id: string): Promise<void>;
`;

describe('package type-definition diff', () => {
  it('extracts exported declarations', () => {
    const decls = extractDeclarations([{ path: 'index.d.ts', content: BEFORE }]);
    expect(decls.some((d) => d.name === 'Client')).toBe(true);
    expect(decls.some((d) => d.name === 'helper')).toBe(true);
    expect(decls.some((d) => d.name.includes('createCharge'))).toBe(true);
  });

  it('detects signature and required-flag changes plus added exports', () => {
    const before = extractDeclarations([{ path: 'a.d.ts', content: BEFORE }]);
    const after = extractDeclarations([{ path: 'a.d.ts', content: AFTER }]);
    const changes = diffDeclarations(before, after);

    expect(changes.some((c) => c.kind === 'export_added' && c.path === 'refund')).toBe(true);
    expect(changes.some((c) => c.path.includes('createCharge'))).toBe(true);
    expect(changes.some((c) => c.kind === 'required_flag_changed' || c.kind === 'signature_changed')).toBe(
      true,
    );
  });
});
