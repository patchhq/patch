# Patch

Detect upstream API breaking changes and open pull requests that fix your TypeScript/JavaScript codebase.

```bash
npx -y @patch-dev/cli init
# confirm connectors → writes patch.config.json, scaffolds GitHub Action
# install the GitHub App (human step)
# scheduled `patch scan` opens PRs or Issues when APIs break
```

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

Three connector types prove the architecture generalizes across **API sources**.
Language scanners prove it generalizes across **codebases** (TS today; Python / Rust / Go stubs ready — see [docs/languages.md](./docs/languages.md)).
User/default **rules** steer the fix agent — see [docs/rules.md](./docs/rules.md).

| Connector | Source | Reliability |
|-----------|--------|-------------|
| `openapi-diff` | Formal OpenAPI JSON/YAML | Highest — structural contract |
| `package-diff` | npm/PyPI + `.d.ts` | High — exact signatures |
| `doc-scrape` | HTML docs, no formal spec | Lower — LLM bears more burden |

## Quick start

```bash
# In your TS/JS repo (scoped package — not the unrelated npm `patch`)
npx -y @patch-dev/cli init --yes
npx -y @patch-dev/cli scan --dry-run
```

See [docs/publishing.md](./docs/publishing.md) for pack/publish details.

Set `ANTHROPIC_API_KEY` for LLM classification/fix generation. Without it, Patch falls back to deterministic heuristics (useful for CI of Patch itself).

Set `GITHUB_TOKEN` (or install the Patch GitHub App) to open PRs/Issues. Without it, reports land in `.patch/reports/`.

## Confidence scoring

| Validation outcome | Confidence ceiling |
|--------------------|--------------------|
| `tsc` + tests pass | uncapped (model score) |
| `tsc` passes, no tests | ≤ 0.75 |
| `tsc` fails | ≤ 0.25 |

Above `confidence_threshold` (default `0.7`) → **PR**. Below → **Issue** with the same diagnosis.

## Monorepo

```
packages/cli            @patch-dev/cli (published; bundles the rest)
packages/core           schemas + connector + LanguageScanner interfaces
packages/scanner-ts     TypeScript/JavaScript scanner (implemented)
packages/scanner-python Python scanner stub
packages/scanner-rust   Rust scanner stub
packages/scanner-go     Go scanner stub
packages/connectors/*   openapi-diff, doc-scrape, package-diff
packages/classify       RawChange → ChangeEvent
packages/fix           patch generation + per-language validation
packages/github-app     PR/Issue bot
apps/backend            hosted multi-tenant scheduler
examples/fixture-repo   dogfood target
```

```bash
pnpm install
pnpm build
pnpm test
```

## Dogfooding the fixture

```bash
pnpm build
node examples/dogfood.mjs
```

See [examples/dogfood.md](./examples/dogfood.md) for the manual baseline → break → scan walkthrough.
## Open source vs hosted

**Open source (Apache-2.0):** CLI, connectors, scanner, PR templates, schemas.

**Hosted:** cross-customer scheduler, Claude classification/fix calls, certified connector packs for APIs without formal specs.

Self-hosting is possible; it's just more work than paying for the hosted version.

## Known MVP limitations

- TypeScript/JavaScript call-site scanning is implemented; Python / Rust / Go scanners detect the repo but do not yet match call sites ([docs/languages.md](./docs/languages.md))
- Dynamic `import()` is not scanned
- PyPI registry path is stubbed (npm + local packages work)

## License

Apache-2.0 — see [LICENSE](./LICENSE).
