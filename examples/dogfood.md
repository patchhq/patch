# Dogfooding Patch (fixture E2E)

This walkthrough proves the full pipeline on `examples/fixture-repo` without GitHub credentials.

## Prerequisites

```bash
pnpm install
pnpm build
```

No `ANTHROPIC_API_KEY` is required — classify/fix fall back to heuristics (good for CI).

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
classified 1 event(s), 1 fix instruction(s)
ChargeOptions: 4 match site(s)
  src/consumer-default.ts:6 confidence=55% check=true … passedOn=1
  src/consumer-named.ts:6 …
  src/consumer-namespace.ts:6 …
  src/consumer-wrapper.ts:6 …
dry-run report: …/.patch/reports/<uuid>.md
```

Heuristic confidence is capped (~55%), so dry-run writes an **Issue-style** report (below the 0.7 PR threshold). With `ANTHROPIC_API_KEY`, classify/fix quality (and confidence) improves.

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
npx -y @patch-dev/cli scan --dry-run
```
