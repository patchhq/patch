# Model providers

Classify and fix call one pluggable provider per run. `patch.config.json` → `model` names it, and the
API key is read from the environment at the boundary. Nothing in this document asks you to put a key
in a config file, and `patch scan` refuses a config that contains one.

## Built-in providers

Two ids come with defaults for `api_key_env`, `model`, dialect and a key signup link:

| `provider` | Dialect   | Default env var     | Default model             |
| ---------- | --------- | ------------------- | ------------------------- |
| `anthropic` | `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `openai`    | `openai`    | `OPENAI_API_KEY`    | `gpt-4o`                   |

```json
{ "model": { "provider": "openai", "api_key_env": "OPENAI_API_KEY", "model": "gpt-4o" } }
```

Their defaults are one data table (`packages/model/src/builtins.ts`), which `patch init`, the config
schema and the key-setup message all read.

## Custom endpoints

Anything that speaks one of the two wire formats works. Three fields are required: `dialect`,
`base_url`, `model`. Add `api_key_env` unless the endpoint takes no key.

```json
{
  "model": {
    "provider": "azure-acme",
    "dialect": "openai",
    "base_url": "https://acme.openai.azure.com/openai/deployments/gpt-4o",
    "model": "gpt-4o",
    "api_key_env": "AZURE_OPENAI_API_KEY",
    "auth": { "scheme": "header", "name": "api-key" },
    "query": { "api-version": "2024-10-21" }
  }
}
```

| Field         | Required       | Meaning                                                                                                                       |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `provider`    | no             | Log identity. A built-in id takes the table's defaults; anything else is a custom endpoint.                                    |
| `dialect`     | custom         | `openai` or `anthropic`. Two dialects exist because each needs its own request/response translator.                            |
| `base_url`    | custom         | Absolute http(s) URL. No `user:pass@`, no token in the path — validate at parse time.                                          |
| `model`       | custom         | The model id the endpoint expects.                                                                                             |
| `api_key_env` | unless keyless | The **name** of the env var holding the key.                                                                                   |
| `auth`        | no             | `api-key` (default; `x-api-key` for Anthropic, `Authorization: Bearer` for OpenAI), `header` + `name`, `query` + `name`, or `none`. |
| `headers`     | no             | Static, non-secret headers. Names like `authorization`, `x-api-key`, `api-key` are rejected — put the key in `api_key_env`.     |
| `query`       | no             | Static query parameters appended to every request.                                                                             |
| `tools`       | no (default `true`) | Whether the endpoint honours tool definitions. See below.                                                                 |

### Auth recipes

```jsonc
// Local server, no key at all
{ "provider": "ollama", "dialect": "openai", "base_url": "http://127.0.0.1:11434/v1",
  "model": "qwen2.5-coder:32b", "auth": { "scheme": "none" } }

// Azure OpenAI — key in the api-key header, api-version as a query parameter
{ "provider": "azure", "dialect": "openai",
  "base_url": "https://acme.openai.azure.com/openai/deployments/gpt-4o",
  "model": "gpt-4o", "api_key_env": "AZURE_OPENAI_API_KEY",
  "auth": { "scheme": "header", "name": "api-key" },
  "query": { "api-version": "2024-10-21" } }

// OpenRouter — vendor headers plus a bearer key
{ "provider": "openrouter", "dialect": "openai", "base_url": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-sonnet-4", "api_key_env": "OPENROUTER_API_KEY",
  "headers": { "HTTP-Referer": "https://github.com/acme/api" } }

// Gateway in front of Claude
{ "provider": "llm-gateway", "dialect": "anthropic",
  "base_url": "https://gateway.internal/anthropic", "model": "claude-sonnet-4-20250514",
  "api_key_env": "GATEWAY_TOKEN" }
```

`auth.scheme: "none"` with an `api_key_env` is a config error, so "keyless" is always deliberate.

### Tool support

`classify` never sends tools. `fix` uses a `read_file` tool call to pull context from your repo, so an
endpoint that ignores tool definitions must say so:

```json
{ "model": { "...": "...", "tools": false } }
```

Then `fix` proposes single-shot (file contents only) and the read_file loop is skipped.

With `tools` unset (the default is on), Patch asks for tool calls first. If the endpoint never uses
them, Patch **says so** — "model provider returned no read_file tool calls — falling back to a
single-shot fix" — and then retries once without tool definitions, so a gateway that silently ignores
tools still produces a fix. Set `tools: false` to skip the wasted first round. If the single-shot
attempt also fails, the error names the provider, the model, the call site, and the switch to flip.

### Where the key goes

The app writes the resolved header set itself, wrapping the SDK's `fetch`, so a key lands in exactly
the header (or query parameter) you asked for and nowhere else. For `auth.scheme: "none"` no
credential header is sent at all.

## In-process providers

`ModelProvider` is a four-member interface (`id`, `model`, optional `capabilities`, `complete`). A
library consumer or a test can hand its own object to any stage:

```ts
import { runScan } from '@patch-dev/cli';
import type { ModelProvider } from '@patch-dev/model';

const provider: ModelProvider = {
  id: 'recording-proxy',
  model: 'gpt-4o-mini',
  capabilities: { tools: true },
  async complete(req) {
    return { content: await callMyGateway(req), toolCalls: [], raw: null };
  },
};

await runScan({ cwd: process.cwd(), dryRun: true, provider });
```

`classifyChanges` and `generateAndValidateFix` accept the same `provider` option. When a provider is
injected, the `model` section of `patch.config.json` is not resolved and no key is read.

## What the config layer refuses

`patch scan` fails before any network call, naming the field and the fix, when:

- a custom provider has no `dialect`, `base_url` or `model`
- a built-in provider declares a different `dialect`
- `auth.scheme` is `header`/`query` without a `name`, or `none` alongside `api_key_env`
- `base_url` is not absolute http(s), or embeds `user:pass@`
- `headers` names a credential header
- any value is key-shaped (`sk-…`, `sk-ant-…`, a PEM key)
- an unknown key appears in `model` (a typo like `baseUrl` fails loudly)

## Limits

- One provider per run; no routing or fallback across providers.
- Two wire dialects only. An endpoint that speaks neither needs a hand-written `ModelProvider`.
- No new runtime dependency: custom endpoints reuse the two SDKs the CLI already ships.
