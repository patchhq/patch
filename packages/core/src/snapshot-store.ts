import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SnapshotSchema, type Snapshot } from './schemas.js';

export interface SnapshotStore {
  get(connectorId: string): Snapshot | null;
  put(snapshot: Snapshot): void;
  list(): Snapshot[];
  close(): void;
}

interface StoreFile {
  snapshots: Record<string, Snapshot>;
  change_event_links: Record<
    string,
    { github_url: string; kind: 'pr' | 'issue'; created_at: string }
  >;
}

/**
 * File-backed snapshot store (JSON).
 * Schema mirrors the planned SQLite tables:
 *   snapshots(connector_id, content_hash, raw_content, fetched_at)
 *   change_event_links(change_event_id, github_url, kind, created_at)
 *
 * Pure JS — no native addons. Suitable for the CLI; swap in another
 * SnapshotStore implementation if you need a different backing store.
 */
export class SqliteSnapshotStore implements SnapshotStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(dbPath: string) {
    // Accept ".db" paths from config for compatibility with the build plan.
    this.path = dbPath.endsWith('.json') ? dbPath : `${dbPath}.json`;
    mkdirSync(dirname(this.path), { recursive: true });
    this.data = this.load();
  }

  private load(): StoreFile {
    if (!existsSync(this.path)) {
      return { snapshots: {}, change_event_links: {} };
    }
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
    } catch {
      return { snapshots: {}, change_event_links: {} };
    }
  }

  private save(): void {
    writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }

  get(connectorId: string): Snapshot | null {
    const row = this.data.snapshots[connectorId];
    if (!row) return null;
    return SnapshotSchema.parse(row);
  }

  put(snapshot: Snapshot): void {
    const parsed = SnapshotSchema.parse(snapshot);
    this.data.snapshots[parsed.connector_id] = parsed;
    this.save();
  }

  list(): Snapshot[] {
    return Object.values(this.data.snapshots).map((r) => SnapshotSchema.parse(r));
  }

  getChangeEventLink(changeEventId: string): { github_url: string; kind: 'pr' | 'issue' } | null {
    const row = this.data.change_event_links[changeEventId];
    if (!row) return null;
    return { github_url: row.github_url, kind: row.kind };
  }

  putChangeEventLink(
    changeEventId: string,
    githubUrl: string,
    kind: 'pr' | 'issue',
  ): void {
    if (this.data.change_event_links[changeEventId]) return;
    this.data.change_event_links[changeEventId] = {
      github_url: githubUrl,
      kind,
      created_at: new Date().toISOString(),
    };
    this.save();
  }

  close(): void {
    this.save();
  }
}

/** SHA-256 hex digest of content — used as Snapshot.content_hash. */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
