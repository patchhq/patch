# Contributing to Patch

Thanks for helping make upstream API breakage less painful.

## Development setup

```bash
pnpm install
pnpm build
pnpm test
```

Requires Node 20+ and pnpm 9+.

## Repo layout

| Path | Purpose |
|------|---------|
| `packages/cli` | Published as `@patch-dev/cli` (`npx -y @patch-dev/cli init`) |
| `packages/core` | Zod schemas, connector interface, snapshot store, config |
| `packages/scanner-ts` | TypeScript/JavaScript call-site scanner (implemented) |
| `packages/scanner-python` | Python scanner stub (extension point) |
| `packages/scanner-rust` | Rust scanner stub (extension point) |
| `packages/scanner-go` | Go scanner stub (extension point) |
| `packages/connectors/*` | OpenAPI, doc-scrape, package-diff reference connectors |
| `packages/classify` | RawChange → ChangeEvent (+ FixInstruction) |
| `packages/fix` | Fix generation + per-language validation |
| `packages/github-app` | PR / Issue publisher |
| `apps/backend` | Hosted scheduler (orchestration) |
| `examples/fixture-repo` | End-to-end test target |
| `examples/dogfood.mjs` | One-shot baseline → break → scan |
| `docs/demo/patch-demo.mp4` | Silent product demo video |
| `demos/video` | Remotion source for the demo |

## Adding a new connector

1. Implement the `Connector` interface from `@patch-dev/core`:

```ts
interface Connector {
  id: string;
  fetchRaw(): Promise<RawSource>;
  diff(previous: RawSource | null, current: RawSource): RawChange[];
}
```

2. Put the package under `packages/connectors/<name>/`.
3. Emit only `RawChange[]` — never call Classify/Scan/Fix yourself. If your connector needs special-casing downstream, the interface boundary is wrong.
4. Store a content hash (or version) so unchanged sources short-circuit.
5. Add unit tests with before/after fixtures (no live network in unit tests).
6. Register the connector in `packages/core/src/registry.ts` so `patch init` can auto-detect it.
7. Confirm Classify → Scan → Fix → PR bot still work unchanged (genericity check).

### Connector types (reference implementations)

- **openapi-diff** — formal spec structural comparison
- **doc-scrape** — HTML → text, section-level similarity filter
- **package-diff** — npm/PyPI version + `.d.ts` declaration diff

## Adding a language scanner

See [docs/languages.md](./docs/languages.md). Short version:

1. Implement `LanguageScanner` in `packages/scanner-<lang>/`.
2. Register it in `packages/cli/src/scanners.ts`.
3. Do not special-case the language in Classify / Fix / PR — only emit `MatchSite[]`.

## Fix-agent rules

See [docs/rules.md](./docs/rules.md). Users can:

- Edit `.patch/rules.md` (scaffolded by `patch init`)
- Set `rules` / `disable_default_rules` / `max_fix_attempts` in `patch.config.json`

Defaults encode: type-check → capture errors → run tests → revise ≤3 times.

## PR checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] New connector includes fixture-based unit tests
- [ ] No secrets committed
- [ ] Docs updated if user-facing behavior changed

## License

Contributions are licensed under Apache-2.0.
