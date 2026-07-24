# Dogfooding Patch (fixture E2E)

This walkthrough proves the full pipeline on `examples/fixture-repo` without GitHub credentials.

## Prerequisites

```bash
pnpm install
pnpm build
export ANTHROPIC_API_KEY=…   # or OPENAI_API_KEY if model.provider is openai
```

`patch scan` requires the API key named in `patch.config.json` → `model.api_key_env`. Without it, scan exits immediately with a clear error (no SDK stack trace).

## One-shot

```bash
node examples/dogfood.mjs
```

That script:

1. Clears `.patch/` and baselines `fake-api-client@1.0.0`
2. Makes `ChargeOptions.currency` required (`1.1.0`)
3. Runs `patch scan --dry-run`
4. Restores `fake-api-client@1.0.0` so the monorepo stays green

## What success looks like

```
Model: anthropic (…) via $ANTHROPIC_API_KEY
classified 1 event(s), 1 fix instruction(s)
ChargeOptions: 4 match site(s)
  …
dry-run report: …/.patch/reports/<uuid>.md
```

## Manual steps

Same flow as the script, using the local CLI:

```bash
rm -rf examples/fixture-repo/.patch
# ensure examples/fake-api-client is at 1.0.0
cd examples/fixture-repo && node ../../packages/cli/dist/bin.js scan --dry-run

# bump fake-api-client to 1.1.0 + required currency in src/index.d.ts
node ../../packages/cli/dist/bin.js scan --dry-run
```

Or against the published package (after npm publish):

```bash
npx patch scan --dry-run
```
