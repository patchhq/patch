# Connectors

Every connector implements:

```ts
interface Connector {
  id: string;
  fetchRaw(): Promise<RawSource>;
  diff(previous: RawSource | null, current: RawSource): RawChange[];
}
```

Downstream stages (Classify, Scan, Fix, PR) must not special-case connector types.

## Built-in registry (`patch init`)

| package.json dep | connector id | type |
|------------------|--------------|------|
| `openai` | `openai-node-sdk` | package-diff |
| `stripe` | `stripe-openapi` | openapi-diff |
| `@octokit/rest` | `github-rest-docs` | doc-scrape |
| `ethers` | `ethers-sdk` | package-diff |
| `@fixture/fake-api-client` | `fixture-fake-api` | package-diff |

## openapi-diff

Fetches an OpenAPI JSON/YAML URL, normalizes paths/methods/params/responses, emits structural `RawChange` kinds:

- `path_added` / `path_removed`
- `param_changed`
- `required_flag_changed`
- `response_schema_changed`

## doc-scrape

Fetches HTML docs, strips nav/boilerplate, sectionizes on headings, and emits changes only when section similarity falls below a threshold (default `0.85`). All changes are `structural_confidence: "low"`.

## package-diff

Polls npm for latest version (or reads a `localPath` for unpublished packages), extracts exported declarations from `.d.ts` via the TypeScript compiler API, and diffs signatures. Pairs with `CHANGELOG.md` when present.

## Config example

```json
{
  "version": 1,
  "confidence_threshold": 0.7,
  "snapshot_db": ".patch/snapshots.db",
  "connectors": [
    {
      "id": "stripe-openapi",
      "type": "openapi-diff",
      "enabled": true,
      "import_path": "stripe",
      "options": {
        "specUrl": "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json"
      }
    }
  ]
}
```
