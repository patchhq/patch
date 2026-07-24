# Fix-agent rules

Users can steer Patch’s agentic fix loop with rules. Detection and classification are unchanged.

## Defaults

Every repo gets these unless disabled in `patch.config.json`:

| id | Behavior |
|----|----------|
| `after-fix-typecheck` | After a patch, run type-check / build |
| `after-fix-capture-errors` | On failure, feed exact compiler output back to the model |
| `after-fix-run-tests` | If type-check passes, run tests; revise on failure |
| `bounded-retries` | Max 3 attempts, then low-confidence Issue path |
| `minimal-diff` | Prefer the smallest correct edit |
| `read-context-sparingly` | `read_file` tool, max 3 reads per attempt |

## Config

`patch.config.json`:

```json
{
  "max_fix_attempts": 3,
  "disable_default_rules": [],
  "rules": [
    {
      "id": "no-legacy",
      "text": "Do not modify files under legacy/",
      "enabled": true
    }
  ]
}
```

Or edit free-form bullets in `.patch/rules.md` (`patch init` scaffolds this file).

## Agentic loop

```
propose patch
  → apply in worktree
  → tsc --noEmit (capture stdout/stderr)
  → if ok and tests exist → run tests (capture output)
  → if failed and attempts < 3 → revise with exact error + optional read_file
  → else stop (validation ceiling applies; attempt count does not)
```

Observability (logged per site):

- `attempts` / `passedOnAttempt`
- `totalFileReads` / `fileReadPaths`
- per-attempt `errorOutput` preview
