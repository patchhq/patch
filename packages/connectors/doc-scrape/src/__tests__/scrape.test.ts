import { describe, it, expect } from 'vitest';
import { htmlToText, sectionize, similarity, diffSections } from '../index.js';

describe('htmlToText', () => {
  it('strips nav/script and keeps headings', () => {
    const html = `
      <nav>Home</nav>
      <script>alert(1)</script>
      <h2>Authentication</h2>
      <p>Use Bearer tokens.</p>
    `;
    const text = htmlToText(html);
    expect(text).toContain('## Authentication');
    expect(text).toContain('Use Bearer tokens.');
    expect(text).not.toContain('Home');
    expect(text).not.toContain('alert');
  });
});

describe('sectionize + similarity', () => {
  it('splits on headings', () => {
    const sections = sectionize('## A\none\n## B\ntwo');
    expect(sections).toHaveLength(2);
    expect(sections[0]!.heading).toBe('A');
  });

  it('scores identical text as 1', () => {
    expect(similarity('hello world foo', 'hello world foo')).toBe(1);
  });

  it('scores unrelated text low', () => {
    expect(similarity('alpha beta gamma', 'one two three')).toBeLessThan(0.2);
  });
});

describe('diffSections', () => {
  it('filters high-similarity rewording', () => {
    const before = '## Auth\nUse an API key in the Authorization header.';
    const after = '## Auth\nUse an API key in the Authorization header!';
    const changes = diffSections(before, after, 0.85);
    expect(changes).toHaveLength(0);
  });

  it('emits low-confidence change for real content edits', () => {
    const before = '## Auth\nUse API keys.';
    const after = '## Auth\nOAuth2 is now required. API keys are removed.';
    const changes = diffSections(before, after, 0.85);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.structural_confidence).toBe('low');
    expect(changes[0]!.kind).toBe('section_changed');
  });

  it('returns empty on first run (no baseline)', () => {
    expect(diffSections(null, '## A\nbody')).toEqual([]);
  });
});
