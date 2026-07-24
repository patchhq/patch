# Language support

Patch’s pipeline is language-agnostic after the **scanner** stage.

```
Connector → Classify → FixInstruction
                            ↓
              LanguageScanner.scan()  ← per-language plugin
                            ↓
                       MatchSite[]
                            ↓
              Fix → LanguageValidator → PR/Issue
```

Connectors, Classify, Fix prompts, and the PR bot do **not** special-case languages.
They only consume `ChangeEvent`, `FixInstruction`, `MatchSite`, and `PatchResult`.

## Status

| Language | Package | Scanner | Validator |
|----------|---------|---------|-----------|
| TypeScript / JavaScript | `@patch-dev/scanner-ts` | Implemented (ts-morph) | `tsc` + `npm test` |
| Python | `@patch-dev/scanner-python` | Stub (detects only) | mypy / pytest hooks ready |
| Rust | `@patch-dev/scanner-rust` | Stub (detects only) | `cargo check` / `cargo test` hooks ready |
| Go | `@patch-dev/scanner-go` | Stub (detects only) | `go build` / `go test` hooks ready |

## Config

`patch init` writes detected languages into `patch.config.json`:

```json
{
  "languages": ["typescript"],
  "connectors": [ … ]
}
```

Omit `languages` to auto-detect on every scan from marker files:

| Language | Markers |
|----------|---------|
| TypeScript | `tsconfig.json` |
| JavaScript | `package.json`, `jsconfig.json` |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt`, `Pipfile` |
| Rust | `Cargo.toml` |
| Go | `go.mod` |

## MatchPattern (language-agnostic)

```ts
{
  import_path: string;  // module specifier in ANY language
  symbol: string;       // nested path, e.g. "Client.create_charge"
  language?: "typescript" | "python" | "rust" | "go" | …
}
```

| Language | `import_path` example |
|----------|----------------------|
| TS/JS | `openai` |
| Python | `openai` |
| Rust | `openai_api` or crate path |
| Go | `github.com/sashabaranov/go-openai` |

## Adding a language scanner

1. Implement `LanguageScanner` from `@patch-dev/core`:

```ts
interface LanguageScanner {
  language: LanguageId;
  extensions: readonly string[];
  name: string;
  detects(repoRoot: string): boolean;
  scan(instruction: FixInstruction, options: { repoRoot: string }): MatchSite[];
  limitations: readonly string[];
}
```

2. Put the package under `packages/scanner-<lang>/` (or replace the stub).
3. Register it in `packages/cli/src/scanners.ts` via `registerScanner(...)`.
4. Optionally implement / extend `LanguageValidator` in `@patch-dev/fix` for compile + test commands.
5. Confirm Classify → Fix → PR still work with **zero** special-casing (genericity check).
6. Add fixture coverage under `examples/`.

Suggested AST stacks for real implementations:

- **Python** — LibCST or tree-sitter-python
- **Rust** — `syn` via a small WASM/native helper, or rust-analyzer
- **Go** — `go/ast` via a Go sidecar, or tree-sitter-go

## Genericity rule

If adding Python/Rust/Go requires changing Classify, Fix prompts, or the PR bot
beyond reading `MatchSite.language` for validation commands, the interface boundary
is wrong — fix the scanner contract instead.
