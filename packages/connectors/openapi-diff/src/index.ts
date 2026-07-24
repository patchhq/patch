import yaml from 'js-yaml';
import {
  contentHash,
  type Connector,
  type RawChange,
  type RawSource,
} from '@patch-dev/core';

export interface OpenApiDiffOptions {
  /** Absolute URL of the OpenAPI JSON/YAML spec. */
  specUrl: string;
  /** Optional override for fetch (tests / offline). */
  fetchImpl?: typeof fetch;
}

interface ParamShape {
  name: string;
  in: string;
  required: boolean;
  schema?: unknown;
}

interface OpShape {
  operationId?: string;
  parameters: ParamShape[];
  requestBodyRequired?: boolean;
  responseSchemas: Record<string, unknown>;
}

type NormalizedSpec = Record<string, Record<string, OpShape>>;

function parseSpec(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown;
  }
  return yaml.load(trimmed);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function normalizeParams(params: unknown): ParamShape[] {
  if (!Array.isArray(params)) return [];
  return params.map((p) => {
    const r = asRecord(p);
    return {
      name: String(r['name'] ?? ''),
      in: String(r['in'] ?? 'query'),
      required: Boolean(r['required']),
      schema: r['schema'],
    };
  });
}

function extractResponseSchemas(responses: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [code, resp] of Object.entries(asRecord(responses))) {
    const content = asRecord(asRecord(resp)['content']);
    const json = asRecord(content['application/json']);
    if (json['schema'] !== undefined) out[code] = json['schema'];
  }
  return out;
}

/** Normalize OpenAPI into path → method → OpShape for structural comparison. */
export function normalizeOpenApi(spec: unknown): NormalizedSpec {
  const root = asRecord(spec);
  const paths = asRecord(root['paths']);
  const result: NormalizedSpec = {};

  for (const [path, pathItem] of Object.entries(paths)) {
    const methods = asRecord(pathItem);
    result[path] = {};
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      if (!(method in methods)) continue;
      const op = asRecord(methods[method]);
      const rb = asRecord(op['requestBody']);
      result[path]![method] = {
        operationId: typeof op['operationId'] === 'string' ? op['operationId'] : undefined,
        parameters: [
          ...normalizeParams(asRecord(pathItem)['parameters']),
          ...normalizeParams(op['parameters']),
        ],
        requestBodyRequired: Boolean(rb['required']),
        responseSchemas: extractResponseSchemas(op['responses']),
      };
    }
  }
  return result;
}

function paramKey(p: ParamShape): string {
  return `${p.in}:${p.name}`;
}

function stableStringify(v: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        sorted[key] = normalize(obj[key]);
      }
      return sorted;
    }
    return value;
  };
  return JSON.stringify(normalize(v));
}

/** Pure structural diff — unit-tested against fixtures without network. */
export function diffNormalized(
  before: NormalizedSpec | null,
  after: NormalizedSpec,
): RawChange[] {
  const changes: RawChange[] = [];
  const prev = before ?? {};

  for (const path of Object.keys(after)) {
    if (!(path in prev)) {
      changes.push({
        kind: 'path_added',
        path,
        after: after[path],
        structural_confidence: 'high',
      });
      continue;
    }
    const prevMethods = prev[path]!;
    const nextMethods = after[path]!;

    for (const method of Object.keys(nextMethods)) {
      const opPath = `${method.toUpperCase()} ${path}`;
      if (!(method in prevMethods)) {
        changes.push({
          kind: 'path_added',
          path: opPath,
          after: nextMethods[method],
          structural_confidence: 'high',
        });
        continue;
      }
      const a = prevMethods[method]!;
      const b = nextMethods[method]!;

      const prevParams = new Map(a.parameters.map((p) => [paramKey(p), p]));
      const nextParams = new Map(b.parameters.map((p) => [paramKey(p), p]));

      for (const [key, np] of nextParams) {
        const op = prevParams.get(key);
        if (!op) {
          changes.push({
            kind: 'param_changed',
            path: `${opPath}#${key}`,
            before: null,
            after: np,
            excerpt: `Parameter ${key} added`,
            structural_confidence: 'high',
          });
          continue;
        }
        if (op.required !== np.required) {
          changes.push({
            kind: 'required_flag_changed',
            path: `${opPath}#${key}`,
            before: { required: op.required },
            after: { required: np.required },
            structural_confidence: 'high',
          });
        }
        if (stableStringify(op.schema) !== stableStringify(np.schema)) {
          changes.push({
            kind: 'param_changed',
            path: `${opPath}#${key}`,
            before: op,
            after: np,
            excerpt: `Schema changed for ${key}`,
            structural_confidence: 'high',
          });
        }
      }

      for (const [key, op] of prevParams) {
        if (!nextParams.has(key)) {
          changes.push({
            kind: 'param_changed',
            path: `${opPath}#${key}`,
            before: op,
            after: null,
            excerpt: `Parameter ${key} removed`,
            structural_confidence: 'high',
          });
        }
      }

      const prevCodes = new Set(Object.keys(a.responseSchemas));
      const nextCodes = new Set(Object.keys(b.responseSchemas));
      for (const code of nextCodes) {
        if (
          !prevCodes.has(code) ||
          stableStringify(a.responseSchemas[code]) !==
            stableStringify(b.responseSchemas[code])
        ) {
          changes.push({
            kind: 'response_schema_changed',
            path: `${opPath}#response:${code}`,
            before: a.responseSchemas[code] ?? null,
            after: b.responseSchemas[code],
            structural_confidence: 'high',
          });
        }
      }
      for (const code of prevCodes) {
        if (!nextCodes.has(code)) {
          changes.push({
            kind: 'response_schema_changed',
            path: `${opPath}#response:${code}`,
            before: a.responseSchemas[code],
            after: null,
            structural_confidence: 'high',
          });
        }
      }
    }

    for (const method of Object.keys(prevMethods)) {
      if (!(method in nextMethods)) {
        changes.push({
          kind: 'path_removed',
          path: `${method.toUpperCase()} ${path}`,
          before: prevMethods[method],
          structural_confidence: 'high',
        });
      }
    }
  }

  for (const path of Object.keys(prev)) {
    if (!(path in after)) {
      changes.push({
        kind: 'path_removed',
        path,
        before: prev[path],
        structural_confidence: 'high',
      });
    }
  }

  return changes;
}

export class OpenApiDiffConnector implements Connector {
  readonly id: string;
  readonly name: string;
  private readonly options: OpenApiDiffOptions;

  constructor(id: string, options: OpenApiDiffOptions, name?: string) {
    this.id = id;
    this.name = name ?? `OpenAPI: ${id}`;
    this.options = options;
  }

  async fetchRaw(): Promise<RawSource> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const res = await fetchImpl(this.options.specUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch OpenAPI spec from ${this.options.specUrl}: ${res.status} ${res.statusText}`,
      );
    }
    const content = await res.text();
    return {
      connector_id: this.id,
      content_hash: contentHash(content),
      content,
      fetched_at: new Date().toISOString(),
      metadata: { specUrl: this.options.specUrl },
    };
  }

  diff(previous: RawSource | null, current: RawSource): RawChange[] {
    if (previous && previous.content_hash === current.content_hash) {
      return [];
    }
    const before = previous
      ? normalizeOpenApi(parseSpec(previous.content))
      : null;
    const after = normalizeOpenApi(parseSpec(current.content));
    return diffNormalized(before, after);
  }
}

export function createOpenApiDiffConnector(
  id: string,
  options: OpenApiDiffOptions,
): Connector {
  return new OpenApiDiffConnector(id, options);
}
