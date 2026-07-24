# `@patch-dev/cli`

Detect upstream API breaking changes, Dependabot-style dependency updates, and open pull requests that fix your TypeScript/JavaScript codebase.

> The bin is named `patch`. The npm package is `@patch-dev/cli` (the unscoped name `patch` on npm is unrelated).

## Quick start

```bash
npx patch init
npx patch scan --dry-run
```

Reliable one-liner if `npx patch` hits the wrong package:

```bash
npx -y --package=@patch-dev/cli patch init
```

`init` writes `patch.config.json`, scaffolds a GitHub Action, and `.patch/rules.md`.  
`scan` fetches connectors, classifies changes, scans call sites, and opens a PR or Issue by confidence.

## Requirements

- Node.js 20+
- Required: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (matches `patch.config.json` → `model`)
- Optional: `GITHUB_TOKEN` or the Patch GitHub App (local reports without it)

## Docs

Full monorepo docs: [github.com/patchhq/patch](https://github.com/patchhq/patch)

## License

Apache-2.0
