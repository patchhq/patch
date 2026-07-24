# Publishing `@patch-dev/cli`

The CLI is the only npm-published package. Workspace libraries (`@patch-dev/core`, connectors, scanners, …) stay private and are **bundled into** the CLI with [tsup](https://tsup.egoist.dev/) so a clean machine never sees `workspace:*`.

## Install / run (consumers)

```bash
# Preferred — scoped package (avoids the unrelated npm package named `patch`)
npx -y @patch-dev/cli init
npx -y @patch-dev/cli scan --dry-run

# Equivalent — install package, invoke the `patch` bin
npx -y --package=@patch-dev/cli patch init
```

Requires Node 20+.

## Maintainers

```bash
pnpm install
pnpm build
pnpm test

# Dry-run tarball (inspect: no workspace:*, bin present)
pnpm pack:cli
tar -tzf packages/cli/patch-dev-cli-*.tgz | head

# Publish (npm login first; package is public under @patch-dev)
pnpm publish:cli
```

Published `dependencies` are only third-party runtime libs (`commander`, `zod`, `ts-morph`, …). All `@patch-dev/*` code is inside `dist/bin.js`.
