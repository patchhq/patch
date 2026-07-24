/**
 * pnpm rewrites workspace:* → versions on pack, but leaves private @patch-dev/*
 * entries in devDependencies. Strip them so the published package.json only
 * lists real npm runtime deps.
 */
import { copyFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const backupPath = join(root, 'package.json.prepack-backup');

const mode = process.argv[2];

if (mode === 'restore') {
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, pkgPath);
    unlinkSync(backupPath);
  }
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
copyFileSync(pkgPath, backupPath);

const strip = (deps) => {
  if (!deps) return deps;
  const next = { ...deps };
  for (const key of Object.keys(next)) {
    if (key.startsWith('@patch-dev/')) delete next[key];
  }
  return next;
};

pkg.devDependencies = strip(pkg.devDependencies);
pkg.dependencies = strip(pkg.dependencies);
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
