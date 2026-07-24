# Confidence scoring

Patch uses two distinct confidence concepts:

1. **Classification confidence** — "is this actually a breaking change?" (from Classify)
2. **Fix confidence** — model self-score for the generated patch, then **capped by validation**

The agentic fix loop may retry up to 3 times using compiler/test output. **Attempt count does not affect confidence** — only the final validation outcome does.

## Validation ceilings

After the final patch attempt in a git worktree:

| Outcome | Ceiling |
|---------|---------|
| type-check **and** tests pass | 1.0 (no cap) |
| type-check passes, no test script | 0.75 |
| type-check fails | 0.25 (tests are not run) |

Final confidence = `min(model_score, ceiling)`.

## PR vs Issue

`patch.config.json` → `confidence_threshold` (default `0.7`):

- **≥ threshold** → open a Pull Request with the patch branch
- **< threshold** → open an Issue with the same diagnosis (no unreviewed code change)

If all fix attempts fail validation, confidence is capped at 0.25 → Issue path.

Re-runs are deduplicated by `change_event_id` so the same upstream change does not spam PRs/Issues.

See also [rules.md](./rules.md) for the agentic fix loop and user rules.
