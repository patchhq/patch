import {
  contentHash,
  type Connector,
  type RawChange,
  type RawSource,
} from '@patch-dev/core';

export interface DocScrapeOptions {
  /** Documentation page URLs to fetch. */
  urls: string[];
  /**
   * Section similarity below this threshold is treated as a real change.
   * Higher = more sensitive (more diffs). Default 0.85.
   */
  similarityThreshold?: number;
  fetchImpl?: typeof fetch;
}

export interface DocSection {
  heading: string;
  body: string;
}

/** Strip HTML to readable text: drop script/style/nav, keep headings + body. */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ');

  text = text
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n\n## $2\n\n')
    .replace(/<\/?(p|div|br|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '');

  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0))
    .join('\n')
    .trim();
}

/** Split normalized doc text into heading → body sections. */
export function sectionize(text: string): DocSection[] {
  const lines = text.split('\n');
  const sections: DocSection[] = [];
  let current: DocSection = { heading: '(preamble)', body: '' };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (current.body.trim() || current.heading !== '(preamble)') {
        sections.push({ ...current, body: current.body.trim() });
      }
      current = { heading: headingMatch[2]!.trim(), body: '' };
    } else {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current.body.trim() || sections.length === 0) {
    sections.push({ ...current, body: current.body.trim() });
  }
  return sections;
}

/** Dice coefficient on word bigrams — cheap section similarity. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const words = s.toLowerCase().split(/\s+/).filter(Boolean);
    const map = new Map<string, number>();
    for (let i = 0; i < words.length - 1; i++) {
      const g = `${words[i]} ${words[i + 1]}`;
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    if (words.length === 1) map.set(words[0]!, 1);
    return map;
  };

  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [g, count] of A) {
    overlap += Math.min(count, B.get(g) ?? 0);
  }
  const total = [...A.values()].reduce((s, n) => s + n, 0) +
    [...B.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export function diffSections(
  previousText: string | null,
  currentText: string,
  similarityThreshold = 0.85,
): RawChange[] {
  if (previousText === null) {
    // First run: no prior baseline — don't emit changes (snapshot will be stored).
    return [];
  }
  if (previousText === currentText) return [];

  const prevSections = sectionize(previousText);
  const nextSections = sectionize(currentText);
  const prevByHeading = new Map(prevSections.map((s) => [s.heading, s]));
  const nextByHeading = new Map(nextSections.map((s) => [s.heading, s]));
  const changes: RawChange[] = [];

  for (const [heading, next] of nextByHeading) {
    const prev = prevByHeading.get(heading);
    if (!prev) {
      changes.push({
        kind: 'section_added',
        path: heading,
        after: next.body,
        excerpt: next.body.slice(0, 400),
        structural_confidence: 'low',
      });
      continue;
    }
    const sim = similarity(prev.body, next.body);
    if (sim < similarityThreshold) {
      changes.push({
        kind: 'section_changed',
        path: heading,
        before: prev.body,
        after: next.body,
        excerpt: `similarity=${sim.toFixed(3)}\n--- before ---\n${prev.body.slice(0, 200)}\n--- after ---\n${next.body.slice(0, 200)}`,
        structural_confidence: 'low',
      });
    }
  }

  for (const [heading, prev] of prevByHeading) {
    if (!nextByHeading.has(heading)) {
      changes.push({
        kind: 'section_removed',
        path: heading,
        before: prev.body,
        excerpt: prev.body.slice(0, 400),
        structural_confidence: 'low',
      });
    }
  }

  return changes;
}

export class DocScrapeConnector implements Connector {
  readonly id: string;
  readonly name: string;
  private readonly options: DocScrapeOptions;

  constructor(id: string, options: DocScrapeOptions, name?: string) {
    this.id = id;
    this.name = name ?? `Docs: ${id}`;
    this.options = options;
  }

  async fetchRaw(): Promise<RawSource> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const parts: string[] = [];
    for (const url of this.options.urls) {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch docs from ${url}: ${res.status}`);
      }
      const html = await res.text();
      parts.push(`# SOURCE ${url}\n\n${htmlToText(html)}`);
    }
    const content = parts.join('\n\n---\n\n');
    return {
      connector_id: this.id,
      content_hash: contentHash(content),
      content,
      fetched_at: new Date().toISOString(),
      metadata: { urls: this.options.urls },
    };
  }

  diff(previous: RawSource | null, current: RawSource): RawChange[] {
    if (previous && previous.content_hash === current.content_hash) {
      return [];
    }
    return diffSections(
      previous?.content ?? null,
      current.content,
      this.options.similarityThreshold ?? 0.85,
    );
  }
}

export function createDocScrapeConnector(
  id: string,
  options: DocScrapeOptions,
): Connector {
  return new DocScrapeConnector(id, options);
}
