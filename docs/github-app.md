# GitHub App setup

Patch opens **PRs** (confidence ≥ threshold) or **Issues** (below threshold) using either:

1. **`GITHUB_TOKEN`** — classic PAT / fine-grained PAT / Actions `secrets.GITHUB_TOKEN`
2. **GitHub App** — recommended bot identity (`PATCH_GITHUB_APP_*`)

## Create the App (one-time, under your org)

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**  
   (org: [patchhq](https://github.com/organizations/patchhq/settings/apps) or your user)
2. Fill in:
   - **GitHub App name:** e.g. `Patch` / `patch-bot`
   - **Homepage URL:** `https://github.com/patchhq/patch`
   - **Webhook:** uncheck Active (CLI polls; no webhook required for MVP)
3. **Repository permissions:**
   - Contents: **Read & write**
   - Issues: **Read & write**
   - Pull requests: **Read & write**
   - Metadata: **Read-only**
4. **Where can this GitHub App be installed?**  
   Any account (public OSS) or Only on this account
5. Create the App → **Generate a private key** → download the `.pem`
6. Note the **App ID** (top of the App settings page)
7. **Install App** on the repos that will run `patch scan`  
   Copy the install URL (or set `PATCH_GITHUB_APP_INSTALL_URL`)

## Secrets / env

| Variable | Where | Purpose |
|----------|--------|---------|
| `PATCH_GITHUB_APP_ID` | Actions secret / `.env` | Numeric App ID |
| `PATCH_GITHUB_APP_PRIVATE_KEY` | Actions secret / `.env` | Full PEM (use `\n` for newlines in env files) |
| `PATCH_GITHUB_APP_INSTALLATION_ID` | Optional | Skip auto lookup of installation for `owner/repo` |
| `PATCH_GITHUB_APP_INSTALL_URL` | Optional | Shown by `patch init` (default `…/apps/patch-bot/…`) |
| `GITHUB_TOKEN` | Optional override | PAT / Actions token — used **instead of** the App when set |
| `ANTHROPIC_API_KEY` | Recommended | LLM classify/fix |

Aliases also accepted: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`.

## Actions workflow

`patch init` scaffolds `.github/workflows/patch.yml` that:

1. Tries [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) (`continue-on-error` if App secrets are unset)
2. Falls back to `secrets.GITHUB_TOKEN`
3. Runs `patch scan`

Repo secrets to add:

- `ANTHROPIC_API_KEY`
- `PATCH_GITHUB_APP_ID`
- `PATCH_GITHUB_APP_PRIVATE_KEY`

## Local publish (non–dry-run)

```bash
export PATCH_GITHUB_APP_ID=…
export PATCH_GITHUB_APP_PRIVATE_KEY="$(cat path/to/app.pem)"
# or: export GITHUB_TOKEN=ghp_…
npx -y @patch-dev/cli scan
```

Auth precedence: **PAT (`GITHUB_TOKEN`) → GitHub App**.

## What gets published

- **PR** when average confidence ≥ `confidence_threshold` (default `0.7`): Patch commits typecheck-passing fixes on a `patch/…` branch, pushes it, opens the PR
- **Issue** when below threshold, or when the branch push fails (diagnosis still recorded)
