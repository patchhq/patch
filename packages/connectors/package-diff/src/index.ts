import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import {
  contentHash,
  type Connector,
  type RawChange,
  type RawSource,
} from '@patch-dev/core';

export interface PackageDiffOptions {
  /** npm or PyPI package name. */
  package: string;
  registry?: 'npm' | 'pypi';
  /**
   * Optional local path to a package (for fixture / unpublished packages).
   * When set, skips registry polling and diffs local .d.ts files + package.json version.
   */
  localPath?: string;
  fetchImpl?: typeof fetch;
}

export interface ExportedDecl {
  name: string;
  kind: string;
  signature: string;
}

interface PackageSnapshotPayload {
  version: string;
  declarations: ExportedDecl[];
  changelog: string | null;
}

function walkDtsFiles(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...walkDtsFiles(full, root));
    } else if (entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Parse .d.ts files and extract exported declaration signatures. */
export function extractDeclarations(dtsContents: Array<{ path: string; content: string }>): ExportedDecl[] {
  const decls: ExportedDecl[] = [];

  for (const file of dtsContents) {
    const source = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node) => {
      const isExported =
        (ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) ||
        ts.isExportAssignment(node);

      if (ts.isFunctionDeclaration(node) && node.name && isExported) {
        decls.push({
          name: node.name.text,
          kind: 'function',
          signature: node.getText(source).replace(/\s+/g, ' ').trim(),
        });
      } else if (ts.isClassDeclaration(node) && node.name && isExported) {
        decls.push({
          name: node.name.text,
          kind: 'class',
          signature: summarizeClass(node, source),
        });
      } else if (ts.isInterfaceDeclaration(node) && isExported) {
        decls.push({
          name: node.name.text,
          kind: 'interface',
          signature: node.getText(source).replace(/\s+/g, ' ').trim(),
        });
      } else if (ts.isTypeAliasDeclaration(node) && isExported) {
        decls.push({
          name: node.name.text,
          kind: 'type',
          signature: node.getText(source).replace(/\s+/g, ' ').trim(),
        });
      } else if (ts.isModuleDeclaration(node) && isExported) {
        decls.push({
          name: node.name.getText(source),
          kind: 'namespace',
          signature: node.getText(source).replace(/\s+/g, ' ').trim().slice(0, 500),
        });
      } else if (
        ts.isVariableStatement(node) &&
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) {
            decls.push({
              name: d.name.text,
              kind: 'variable',
              signature: node.getText(source).replace(/\s+/g, ' ').trim(),
            });
          }
        }
      }

      // Also collect class/interface members for finer diffs
      if (ts.isClassDeclaration(node) && node.name && isExported) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            decls.push({
              name: `${node.name.text}.${member.name.text}`,
              kind: 'method',
              signature: member.getText(source).replace(/\s+/g, ' ').trim(),
            });
          }
          if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            decls.push({
              name: `${node.name.text}.${member.name.text}`,
              kind: 'property',
              signature: member.getText(source).replace(/\s+/g, ' ').trim(),
            });
          }
        }
      }
      if (ts.isInterfaceDeclaration(node) && isExported) {
        for (const member of node.members) {
          if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
            decls.push({
              name: `${node.name.text}.${member.name.text}`,
              kind: 'method',
              signature: member.getText(source).replace(/\s+/g, ' ').trim(),
            });
          }
          if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
            const optional = member.questionToken ? '?' : '';
            decls.push({
              name: `${node.name.text}.${member.name.text}${optional}`,
              kind: 'property',
              signature: member.getText(source).replace(/\s+/g, ' ').trim(),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  // Dedupe by name, prefer longer signatures
  const byName = new Map<string, ExportedDecl>();
  for (const d of decls) {
    const existing = byName.get(d.name);
    if (!existing || d.signature.length > existing.signature.length) {
      byName.set(d.name, d);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeClass(node: ts.ClassDeclaration, source: ts.SourceFile): string {
  const name = node.name?.text ?? 'Anonymous';
  const methods = node.members
    .filter(ts.isMethodDeclaration)
    .map((m) => m.getText(source).replace(/\s+/g, ' ').trim())
    .join('; ');
  return `class ${name} { ${methods} }`;
}

/** Structural declaration diff used by the package connector and unit tests. */
export function diffDeclarations(
  before: ExportedDecl[],
  after: ExportedDecl[],
): RawChange[] {
  const prev = new Map(before.map((d) => [d.name, d]));
  const next = new Map(after.map((d) => [d.name, d]));
  const changes: RawChange[] = [];

  for (const [name, decl] of next) {
    const old = prev.get(name);
    if (!old) {
      changes.push({
        kind: 'export_added',
        path: name,
        after: decl,
        structural_confidence: 'high',
      });
    } else if (old.signature !== decl.signature) {
      const requiredChanged =
        (old.signature.includes('?') && !decl.signature.includes('?')) ||
        (!old.signature.includes('?') && decl.signature.includes('?'));
      changes.push({
        kind: requiredChanged ? 'required_flag_changed' : 'signature_changed',
        path: name,
        before: old,
        after: decl,
        excerpt: `${old.signature} → ${decl.signature}`,
        structural_confidence: 'high',
      });
    }
  }

  for (const [name, decl] of prev) {
    if (!next.has(name)) {
      changes.push({
        kind: 'export_removed',
        path: name,
        before: decl,
        structural_confidence: 'high',
      });
    }
  }

  return changes;
}

async function fetchNpmMetadata(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<{ version: string; tarball: string }> {
  const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
  if (!res.ok) throw new Error(`npm registry error for ${packageName}: ${res.status}`);
  const data = (await res.json()) as {
    'dist-tags': { latest: string };
    versions: Record<string, { dist: { tarball: string } }>;
  };
  const version = data['dist-tags'].latest;
  const tarball = data.versions[version]?.dist.tarball;
  if (!tarball) throw new Error(`No tarball for ${packageName}@${version}`);
  return { version, tarball };
}

function loadLocalPackage(localPath: string): PackageSnapshotPayload {
  const pkgJsonPath = join(localPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    version: string;
    types?: string;
    typings?: string;
  };

  const dtsFiles = walkDtsFiles(localPath);
  // Prefer explicit types entry
  const typesEntry = pkg.types ?? pkg.typings;
  if (typesEntry) {
    const abs = join(localPath, typesEntry);
    if (existsSync(abs) && !dtsFiles.includes(abs)) dtsFiles.unshift(abs);
  }

  const contents = dtsFiles.map((p) => ({
    path: relative(localPath, p),
    content: readFileSync(p, 'utf8'),
  }));

  let changelog: string | null = null;
  for (const name of ['CHANGELOG.md', 'changelog.md', 'HISTORY.md']) {
    const p = join(localPath, name);
    if (existsSync(p)) {
      changelog = readFileSync(p, 'utf8');
      break;
    }
  }

  return {
    version: pkg.version,
    declarations: extractDeclarations(contents),
    changelog,
  };
}

export class PackageDiffConnector implements Connector {
  readonly id: string;
  readonly name: string;
  private readonly options: PackageDiffOptions;

  constructor(id: string, options: PackageDiffOptions, name?: string) {
    this.id = id;
    this.name = name ?? `Package: ${options.package}`;
    this.options = options;
  }

  async fetchRaw(): Promise<RawSource> {
    let payload: PackageSnapshotPayload;

    if (this.options.localPath) {
      payload = loadLocalPackage(this.options.localPath);
    } else if ((this.options.registry ?? 'npm') === 'npm') {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const meta = await fetchNpmMetadata(this.options.package, fetchImpl);
      // For MVP without full tarball extract in CI, store version + metadata.
      // Full .d.ts extraction happens when localPath is set or via optional download.
      payload = {
        version: meta.version,
        declarations: [],
        changelog: null,
      };

      // Try to resolve installed package types from node_modules as a pragmatic MVP path
      try {
        const require = createRequire(join(process.cwd(), 'package.json'));
        const resolved = require.resolve(`${this.options.package}/package.json`);
        const pkgDir = join(resolved, '..');
        const local = loadLocalPackage(pkgDir);
        if (local.version === meta.version || local.declarations.length > 0) {
          payload = { ...local, version: meta.version };
        }
      } catch {
        // package not installed locally — version-only snapshot
      }
    } else {
      throw new Error('PyPI registry support is stubbed for MVP; use npm or localPath');
    }

    const content = JSON.stringify(payload);
    return {
      connector_id: this.id,
      content_hash: contentHash(`${payload.version}:${contentHash(content)}`),
      content,
      fetched_at: new Date().toISOString(),
      metadata: {
        package: this.options.package,
        version: payload.version,
        registry: this.options.registry ?? 'npm',
      },
    };
  }

  diff(previous: RawSource | null, current: RawSource): RawChange[] {
    if (previous && previous.content_hash === current.content_hash) {
      return [];
    }
    if (!previous) return [];

    const prev = JSON.parse(previous.content) as PackageSnapshotPayload;
    const next = JSON.parse(current.content) as PackageSnapshotPayload;

    if (prev.version === next.version && prev.declarations.length === 0) {
      return [];
    }

    const changes = diffDeclarations(prev.declarations, next.declarations);

    if (next.changelog && next.changelog !== prev.changelog) {
      changes.push({
        kind: 'changelog_updated',
        path: 'CHANGELOG.md',
        before: prev.changelog,
        after: next.changelog,
        excerpt: next.changelog.slice(0, 800),
        structural_confidence: 'high',
      });
    }

    if (prev.version !== next.version && changes.length === 0) {
      changes.push({
        kind: 'version_bump',
        path: this.options.package,
        before: { version: prev.version },
        after: { version: next.version },
        excerpt: `${prev.version} → ${next.version}`,
        structural_confidence: 'high',
      });
    }

    return changes;
  }
}

export function createPackageDiffConnector(
  id: string,
  options: PackageDiffOptions,
): Connector {
  return new PackageDiffConnector(id, options);
}
