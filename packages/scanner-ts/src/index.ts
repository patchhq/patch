import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  Project,
  SyntaxKind,
  type ImportDeclaration,
  type Node,
  type SourceFile,
} from 'ts-morph';
import type {
  FixInstruction,
  LanguageScanner,
  MatchSite,
} from '@patch-dev/core';
import { LANGUAGE_MARKERS } from '@patch-dev/core';

export interface ScanOptions {
  /** Absolute path to the target repository root. */
  repoRoot: string;
  /** Optional path to tsconfig.json (defaults to repoRoot/tsconfig.json). */
  tsconfigPath?: string;
}

/**
 * Known MVP limitation: dynamic `import()` is not followed.
 * Only static import declarations (and re-export wrappers) are scanned.
 */
export const KNOWN_LIMITATIONS = [
  'Dynamic import() expressions are not resolved in MVP.',
  'CommonJS require() of non-literal strings is not resolved.',
] as const;

interface Binding {
  localName: string;
  isNamespace: boolean;
}

function resolveTsConfig(repoRoot: string, tsconfigPath?: string): string | undefined {
  const candidate = tsconfigPath ?? join(repoRoot, 'tsconfig.json');
  return existsSync(candidate) ? candidate : undefined;
}

function snippetAround(sourceFile: SourceFile, line: number, contextLines = 2): string {
  const lines = sourceFile.getFullText().split(/\r?\n/);
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join('\n');
}

function moduleMatches(spec: string, importPath: string): boolean {
  return spec === importPath || spec.startsWith(`${importPath}/`);
}

function bindingsFromImport(decl: ImportDeclaration): Binding[] {
  const bindings: Binding[] = [];
  const defaultImport = decl.getDefaultImport();
  if (defaultImport) {
    bindings.push({ localName: defaultImport.getText(), isNamespace: false });
  }
  const ns = decl.getNamespaceImport();
  if (ns) {
    bindings.push({ localName: ns.getText(), isNamespace: true });
  }
  for (const named of decl.getNamedImports()) {
    const alias = named.getAliasNode();
    bindings.push({
      localName: alias ? alias.getText() : named.getName(),
      isNamespace: false,
    });
  }
  return bindings;
}

function findImportBindings(sourceFile: SourceFile, importPath: string): Binding[] {
  const bindings: Binding[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    if (!moduleMatches(decl.getModuleSpecifierValue(), importPath)) continue;
    bindings.push(...bindingsFromImport(decl));
  }
  return bindings;
}

function findReExportSources(project: Project, importPath: string): Set<string> {
  const wrappers = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    for (const decl of sf.getExportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (spec && moduleMatches(spec, importPath)) {
        wrappers.add(sf.getFilePath());
      }
    }
  }
  return wrappers;
}

function symbolParts(symbol: string): string[] {
  return symbol.split('.').filter(Boolean);
}

function collectDerivedAliases(sourceFile: SourceFile, bindingNames: Set<string>): Set<string> {
  const aliases = new Set<string>(bindingNames);

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.Identifier) continue;
    const name = nameNode.getText();
    const init = decl.getInitializer();
    if (!init) continue;

    let expr: Node = init;
    if (expr.getKind() === SyntaxKind.AwaitExpression) {
      expr = expr.asKindOrThrow(SyntaxKind.AwaitExpression).getExpression();
    }

    if (expr.getKind() === SyntaxKind.NewExpression) {
      const ctor = expr.asKindOrThrow(SyntaxKind.NewExpression).getExpression();
      const root = ctor.getKind() === SyntaxKind.Identifier ? ctor.getText() : null;
      if (root && aliases.has(root)) {
        aliases.add(name);
      }
      continue;
    }

    if (expr.getKind() === SyntaxKind.CallExpression) {
      const callee = expr.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
      if (callee.getKind() === SyntaxKind.Identifier && aliases.has(callee.getText())) {
        aliases.add(name);
      } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        const obj = pae.getExpression();
        if (obj.getKind() === SyntaxKind.Identifier && aliases.has(obj.getText())) {
          aliases.add(name);
        }
      }
    }
  }

  return aliases;
}

function calleeMatchesSymbol(
  callee: Node,
  parts: string[],
  bindingNames: Set<string>,
): boolean {
  if (parts.length === 0) {
    let current: Node = callee;
    while (
      current.getKind() === SyntaxKind.CallExpression ||
      current.getKind() === SyntaxKind.NewExpression ||
      current.getKind() === SyntaxKind.PropertyAccessExpression ||
      current.getKind() === SyntaxKind.ParenthesizedExpression
    ) {
      if (current.getKind() === SyntaxKind.PropertyAccessExpression) {
        current = current.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
      } else if (current.getKind() === SyntaxKind.CallExpression) {
        current = current.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
      } else if (current.getKind() === SyntaxKind.NewExpression) {
        current = current.asKindOrThrow(SyntaxKind.NewExpression).getExpression();
      } else {
        current = current.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
      }
    }
    return (
      current.getKind() === SyntaxKind.Identifier &&
      bindingNames.has(current.getText())
    );
  }

  const chain: string[] = [];
  let current: Node = callee;
  while (current.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pae = current.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    chain.unshift(pae.getName());
    current = pae.getExpression();
    while (
      current.getKind() === SyntaxKind.CallExpression ||
      current.getKind() === SyntaxKind.NewExpression ||
      current.getKind() === SyntaxKind.ParenthesizedExpression ||
      current.getKind() === SyntaxKind.AwaitExpression
    ) {
      if (current.getKind() === SyntaxKind.CallExpression) {
        current = current.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
      } else if (current.getKind() === SyntaxKind.NewExpression) {
        current = current.asKindOrThrow(SyntaxKind.NewExpression).getExpression();
      } else if (current.getKind() === SyntaxKind.ParenthesizedExpression) {
        current = current.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
      } else {
        current = current.asKindOrThrow(SyntaxKind.AwaitExpression).getExpression();
      }
    }
  }

  if (current.getKind() !== SyntaxKind.Identifier) return false;
  const name = current.getText();
  if (!bindingNames.has(name)) return false;

  if (chain.length === 0) {
    return parts[parts.length - 1] === name || parts.join('.') === name;
  }

  if (chain.length >= parts.length) {
    const slice = chain.slice(chain.length - parts.length);
    if (slice.every((p, i) => p === parts[i])) return true;
  }

  return false;
}

function collectMatchSites(
  sourceFile: SourceFile,
  bindings: Binding[],
  symbol: string,
  repoRoot: string,
): MatchSite[] {
  if (bindings.length === 0) return [];
  const sites: MatchSite[] = [];
  const parts = symbolParts(symbol);
  const bindingNames = new Set(bindings.map((b) => b.localName));
  const aliases = collectDerivedAliases(sourceFile, bindingNames);

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!calleeMatchesSymbol(callee, parts, aliases)) continue;

    const { line, column } = sourceFile.getLineAndColumnAtPos(call.getStart());
    sites.push({
      file: relative(repoRoot, sourceFile.getFilePath()).replace(/\\/g, '/'),
      line,
      column,
      snippet: snippetAround(sourceFile, line),
      language: 'typescript',
    });
  }

  return sites;
}

/**
 * Scan a TypeScript/JavaScript repo for call sites matching a FixInstruction.
 */
export function scanForMatches(
  instruction: FixInstruction,
  options: ScanOptions,
): MatchSite[] {
  const hint = instruction.match_pattern.language;
  if (hint && hint !== 'typescript' && hint !== 'javascript') {
    return [];
  }

  const tsconfig = resolveTsConfig(options.repoRoot, options.tsconfigPath);
  const project = tsconfig
    ? new Project({
        tsConfigFilePath: tsconfig,
        skipAddingFilesFromTsConfig: false,
      })
    : new Project({
        compilerOptions: {
          allowJs: true,
          target: 99,
          module: 99,
        },
      });

  if (!tsconfig) {
    project.addSourceFilesAtPaths([
      join(options.repoRoot, 'src/**/*.{ts,tsx,js,jsx}'),
      join(options.repoRoot, '*.{ts,tsx,js,jsx}'),
    ]);
  }

  const srcGlob = join(options.repoRoot, 'src/**/*.{ts,tsx,js,jsx}').replace(/\\/g, '/');
  project.addSourceFilesAtPaths(srcGlob);

  const { import_path, symbol } = instruction.match_pattern;
  const reExportFiles = findReExportSources(project, import_path);
  const sites: MatchSite[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().endsWith('.d.ts')) continue;
    if (sourceFile.getFilePath().includes('node_modules')) continue;

    const bindings = findImportBindings(sourceFile, import_path);

    for (const decl of sourceFile.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (!(spec.startsWith('.') || spec.startsWith('/'))) continue;
      try {
        const resolved = decl.getModuleSpecifierSourceFile();
        if (resolved && reExportFiles.has(resolved.getFilePath())) {
          bindings.push(...bindingsFromImport(decl));
        }
      } catch {
        // unresolved
      }
    }

    for (const site of collectMatchSites(sourceFile, bindings, symbol, options.repoRoot)) {
      const key = `${site.file}:${site.line}:${site.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        sites.push(site);
      }
    }
  }

  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function detectsTypescript(repoRoot: string): boolean {
  const markers = LANGUAGE_MARKERS.typescript.files;
  if (markers.some((f) => existsSync(join(repoRoot, f)))) return true;
  return existsSync(join(repoRoot, 'package.json'));
}

/**
 * LanguageScanner implementation for TypeScript / JavaScript.
 */
export class TypescriptScanner implements LanguageScanner {
  readonly language = 'typescript' as const;
  readonly name = 'TypeScript / JavaScript';
  readonly extensions = LANGUAGE_MARKERS.typescript.extensions;
  readonly limitations = KNOWN_LIMITATIONS;

  detects(repoRoot: string): boolean {
    return detectsTypescript(repoRoot);
  }

  scan(instruction: FixInstruction, options: { repoRoot: string }): MatchSite[] {
    return scanForMatches(instruction, options);
  }
}

export function createScanner(options?: ScanOptions): LanguageScanner {
  const scanner = new TypescriptScanner();
  if (!options) return scanner;
  return {
    language: scanner.language,
    name: scanner.name,
    extensions: scanner.extensions,
    limitations: scanner.limitations,
    detects: (root) => scanner.detects(root),
    scan: (instruction) => scanForMatches(instruction, options),
  };
}
