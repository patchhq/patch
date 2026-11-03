import type { ModelAuth, ModelDialect } from './types.js';

/**
 * Both vendor SDKs insist on a non-empty key string. This value is never a real credential:
 * the endpoint wrapper below deletes the SDK's own auth header and writes the header set we
 * resolved, so this sentinel never reaches the wire.
 */
export const SDK_PLACEHOLDER_KEY = 'patch-no-key';

/** Header names that carry credentials. The endpoint wrapper always decides their fate. */
const AUTH_HEADERS = ['authorization', 'x-api-key'];

export interface EndpointOptions {
  /** Final header set to apply to every request. */
  readonly headers: Readonly<Record<string, string>>;
  /** Final query parameters to apply to every request. */
  readonly query: Readonly<Record<string, string>>;
}

/**
 * Shape of the `fetch` both SDKs accept. Deliberately loose: the SDKs type `init` with
 * node-fetch in some builds and undici in others — including for the `Response` return — so the
 * wrapper fits both by construction instead of by version pin. The resolved value is only ever
 * handed back to the SDK that made the call.
 */
export type EndpointFetch = (input: unknown, init?: unknown) => Promise<never>;

/**
 * Wrap `fetch` so the endpoint decision is made in exactly one place.
 *
 * The SDKs would otherwise merge their own `Authorization` over ours, and their merge order is
 * an internal detail we refuse to depend on. Here we delete the credential headers the SDK
 * sets, then apply the resolved set — which is empty for a keyless endpoint — and append the
 * configured query parameters to the SDK's final URL.
 */
export function withEndpoint(
  options: EndpointOptions,
  baseFetch: typeof fetch = globalThis.fetch,
): EndpointFetch {
  return async (rawInput: unknown, rawInit?: unknown): Promise<never> => {
    const init = rawInit as RequestInit | undefined;
    const rawUrl =
      rawInput instanceof Request ? rawInput.url : String(rawInput);

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return baseFetch(rawInput as Parameters<typeof fetch>[0], init) as Promise<never>;
    }

    for (const [name, value] of Object.entries(options.query)) {
      url.searchParams.set(name, value);
    }

    const headers = new Headers(
      init?.headers ?? (rawInput instanceof Request ? rawInput.headers : undefined),
    );
    for (const name of AUTH_HEADERS) headers.delete(name);
    for (const [name, value] of Object.entries(options.headers)) {
      headers.set(name, value);
    }

    return baseFetch(url.toString(), { ...init, headers }) as Promise<never>;
  };
}

/**
 * Turn a resolved auth decision plus the key into the headers/query it needs.
 * The only place that knows the dialect's native transport.
 */
export function authTransport(
  dialect: ModelDialect,
  auth: ModelAuth,
  apiKey: string | undefined,
): EndpointOptions {
  if (!apiKey || auth.scheme === 'none') return { headers: {}, query: {} };

  if (auth.scheme === 'header') {
    if (!auth.name) throw new Error('auth.scheme "header" requires auth.name');
    return { headers: { [auth.name]: apiKey }, query: {} };
  }
  if (auth.scheme === 'query') {
    if (!auth.name) throw new Error('auth.scheme "query" requires auth.name');
    return { headers: {}, query: { [auth.name]: apiKey } };
  }
  // scheme 'api-key' — the dialect's native transport.
  return dialect === 'anthropic'
    ? { headers: { 'x-api-key': apiKey }, query: {} }
    : { headers: { authorization: `Bearer ${apiKey}` }, query: {} };
}
