# Patch

**Detect upstream API breaking changes and open PRs that fix your TypeScript/JavaScript codebase.**

[![npm](https://img.shields.io/npm/v/@patch-dev/cli.svg)](https://www.npmjs.com/package/@patch-dev/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

```bash
npx -y @patch-dev/cli init
```

Confirms connectors → writes `patch.config.json` → scaffolds a GitHub Action.  
Then scheduled `patch scan` opens a **PR** or **Issue** when an API breaks.

> Prefer the scoped package `@patch-dev/cli` — the unscoped npm name `patch` is unrelated.

## Demo

Silent walkthrough (break → scan → report → install):

https://github.com/patchhq/patch/raw/main/docs/demo/patch-demo.mp4

Or open [`docs/demo/patch-demo.mp4`](./docs/demo/patch-demo.mp4) in the repo.

## Quick start

```bash
# In your TS/JS repo
npx -y @patch-dev/cli init --yes
npx -y @patch-dev/cli scan --dry-run
```

| Env | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | LLM classify/fix (heuristics without it) |
| `GITHUB_TOKEN` or Patch GitHub App | Open PRs/Issues (else `.patch/reports/`) |

## How it works

```
patch init → detect API deps + languages → config + Action + App install
                │
                ▼ (on schedule)
connector fetch → diff snapshot → classify (ChangeEvent)
      → map FixInstruction → LanguageScanner(s)
      → agentic fix loop (propose → validate → revise ≤3)
      → confidence ≥ threshold? PR : Issue → update snapshot
```

| Connector | Source | Reliability |
|-----------|--------|-------------|
| `openapi-diff` | Formal OpenAPI JSON/YAML | Highest — structural contract |
| `package-diff` | npm/PyPI + `.d.ts` | High — exact signatures |
| `doc-scrape` | HTML docs, no formal spec | Lower — LLM bears more burden |

Language scanners: **TypeScript/JavaScript** implemented; Python / Rust / Go stubs — [docs/languages.md](./docs/languages.md).  
Fix-agent rules — [docs/rules.md](./docs/rules.md). Confidence ceilings — [docs/confidence.md](./docs/confidence.md).

## Confidence

| Validation outcome | Confidence ceiling |
|--------------------|--------------------|
| `tsc` + tests pass | uncapped (model score) |
| `tsc` passes, no tests | ≤ 0.75 |
| `tsc` fails | ≤ 0.25 |

Above `confidence_threshold` (default `0.7`) → **PR**. Below → **Issue**.

## Dogfood (this repo)

```bash
pnpm install && pnpm build
pnpm dogfood   # baseline → break currency → scan --dry-run → restore
```

Details: [examples/dogfood.md](./examples/dogfood.md).

## Develop

```
packages/cli            @patch-dev/cli (published; bundles the rest)
packages/core           schemas + connector + LanguageScanner interfaces
packages/scanner-*      TS implemented; python/rust/go stubs
packages/connectors/*   openapi-diff, doc-scrape, package-diff
packages/classify       RawChange → ChangeEvent
packages/fix           agentic fix + validation
packages/github-app     PR/Issue publisher
apps/backend            hosted scheduler (optional)
examples/fixture-repo   E2E target
demos/video             Remotion source for the demo MP4
```

```bash
pnpm install
pnpm build
pnpm test
```

Publishing the CLI: [docs/publishing.md](./docs/publishing.md). Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Open source vs hosted

**Open source (Apache-2.0):** CLI, connectors, scanners, schemas, PR templates — this repo.

**Hosted (optional):** cross-customer scheduler, billed Claude calls, certified connector packs.

## Known MVP limitations

- Dynamic `import()` is not scanned
- PyPI registry path is stubbed (npm + local packages work)
- Non-TS language scanners detect the repo but do not yet match call sites

## License

Apache-2.0 — see [LICENSE](./LICENSE).
