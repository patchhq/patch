# `@patch-dev/cli`

Detect upstream API breaking changes and open pull requests that fix your TypeScript/JavaScript codebase.

> The bin is named `patch`. Prefer the scoped package — the unscoped npm name `patch` is unrelated.

## Quick start

```bash
npx -y @patch-dev/cli init
npx -y @patch-dev/cli scan --dry-run
```

`init` writes `patch.config.json`, scaffolds a GitHub Action, and `.patch/rules.md`.  
`scan` fetches connectors, classifies changes, scans call sites, and opens a PR or Issue by confidence.

## Requirements

- Node.js 20+
- Optional: `ANTHROPIC_API_KEY` (LLM classify/fix; heuristics without it)
- Optional: `GITHUB_TOKEN` or the Patch GitHub App (local reports without it)

## Docs

Full monorepo docs: [github.com/patchhq/patch](https://github.com/patchhq/patch)

## License

Apache-2.0
