import type {
  X402DiscoveredResource,
  X402DiscoveryOptions,
  X402DiscoveryResult,
  X402PaymentAccept,
} from './types.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readVersion(value: unknown): number | string | undefined {
  return readNumber(value) ?? readString(value);
}

function normalizeOrigin(origin: string | URL): URL {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`x402 discovery requires an http(s) origin. Got: ${url.protocol}`);
  }
  return new URL(url.origin);
}

function resolveUrl(value: unknown, base: URL): string | undefined {
  const url = readString(value);
  if (!url) return undefined;

  try {
    return new URL(url, base).href;
  } catch {
    return undefined;
  }
}

function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function appendOpenApiPath(path: string, serverBase: URL): string | undefined {
  try {
    const resource = new URL(path, 'http://openapi.local');
    const basePath = serverBase.pathname === '/' ? '' : serverBase.pathname.replace(/\/$/, '');
    const url = new URL(serverBase.href);
    url.pathname = `${basePath}${resource.pathname}`;
    url.search = resource.search;
    url.hash = resource.hash;
    return url.href;
  } catch {
    return undefined;
  }
}

function resolveOpenApiResourceUrl(
  value: unknown,
  serverBase: URL,
  fallbackPath: string,
): string | undefined {
  const explicitUrl = readString(value);
  if (explicitUrl && hasScheme(explicitUrl)) {
    return resolveUrl(explicitUrl, serverBase);
  }

  return appendOpenApiPath(explicitUrl ?? fallbackPath, serverBase);
}

function pathFromUrl(url: string, origin: URL): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin.origin ? `${parsed.pathname}${parsed.search}` : undefined;
  } catch {
    return undefined;
  }
}

function parseAccepts(value: unknown): X402PaymentAccept[] {
  return asArray(value).filter(isRecord) as X402PaymentAccept[];
}

function buildResource(
  value: unknown,
  origin: URL,
  defaultAccepts: X402PaymentAccept[],
): X402DiscoveredResource | null {
  if (typeof value === 'string') {
    const url = resolveUrl(value, origin);
    if (!url) return null;
    return {
      url,
      path: pathFromUrl(url, origin),
      accepts: defaultAccepts,
    };
  }

  if (!isRecord(value)) return null;

  const url = resolveUrl(value.url, origin) ?? resolveUrl(value.path, origin);
  if (!url) return null;

  const accepts = parseAccepts(value.accepts);

  return {
    url,
    path: readString(value.path) ?? pathFromUrl(url, origin),
    method: readString(value.method)?.toUpperCase(),
    title: readString(value.title),
    summary: readString(value.summary),
    description: readString(value.description),
    category: readString(value.category),
    providerName: readString(value.providerName),
    providerUrl: readString(value.providerUrl),
    price: readString(value.price),
    priceUsd: readString(value.priceUsd),
    accepts: accepts.length > 0 ? accepts : defaultAccepts,
    metadata: value.metadata && isRecord(value.metadata) ? value.metadata : undefined,
    input: value.input,
    output: value.output,
  };
}

async function fetchJson(
  fetchImpl: typeof globalThis.fetch,
  url: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status?: number; error: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseWellKnownX402(
  data: unknown,
  origin: URL,
  wellKnownUrl: string,
): X402DiscoveryResult | null {
  if (!isRecord(data)) return null;

  const seller = isRecord(data.seller) ? data.seller : {};
  const facilitator = isRecord(data.facilitator) ? data.facilitator : {};
  const accepts = parseAccepts(data.accepts);

  const detailedResources = asArray(data.resourcesDetailed)
    .map((resource) => buildResource(resource, origin, accepts))
    .filter((resource): resource is X402DiscoveredResource => resource !== null);
  const resourceUrls = asArray(data.resources)
    .map((resource) => buildResource(resource, origin, accepts))
    .filter((resource): resource is X402DiscoveredResource => resource !== null);
  const resources = detailedResources.length > 0 ? detailedResources : resourceUrls;

  return {
    origin: readString(seller.origin) ?? origin.origin,
    source: 'well-known',
    enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
    version: readVersion(data.version),
    x402Version: readNumber(data.x402Version),
    facilitatorUrl: readString(facilitator.url),
    openapiUrl: resolveUrl(seller.openapi, origin),
    wellKnownUrl: resolveUrl(seller.wellKnown, origin) ?? wellKnownUrl,
    catalogUrl: resolveUrl(seller.catalog, origin),
    payTo: readString(seller.payTo),
    accepts,
    resources,
  };
}

function getOpenApiServerBase(data: Record<string, unknown>, origin: URL): URL {
  const servers = asArray(data.servers);
  for (const server of servers) {
    if (!isRecord(server)) continue;
    const url = resolveUrl(server.url, origin);
    if (url) return new URL(url);
  }
  return origin;
}

function priceFromPaymentInfo(
  paymentInfo: Record<string, unknown> | undefined,
): string | undefined {
  const price = paymentInfo?.price;
  if (!isRecord(price)) return undefined;

  const amount = readString(price.amount);
  const currency = readString(price.currency);
  if (amount && currency) return `${amount} ${currency}`;
  return amount;
}

function parseOpenApi(data: unknown, origin: URL, openapiUrl: string): X402DiscoveryResult | null {
  if (!isRecord(data)) return null;

  const serverBase = getOpenApiServerBase(data, origin);
  const info = isRecord(data.info) ? data.info : {};
  const xDiscovery = isRecord(data['x-discovery']) ? data['x-discovery'] : {};
  const paths = isRecord(data.paths) ? data.paths : {};
  const resources: X402DiscoveredResource[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation)) continue;

      const paymentInfo = isRecord(operation['x-payment-info'])
        ? operation['x-payment-info']
        : undefined;
      const agentDiscovery = isRecord(operation['x-agent-discovery'])
        ? operation['x-agent-discovery']
        : undefined;
      const responses = isRecord(operation.responses) ? operation.responses : {};
      const hasPaymentResponse = paymentInfo || agentDiscovery || Boolean(responses['402']);

      if (!hasPaymentResponse) continue;

      const url = resolveOpenApiResourceUrl(agentDiscovery?.url, serverBase, path);
      if (!url) continue;

      const response200 = isRecord(responses['200']) ? responses['200'] : {};
      const content = isRecord(response200.content) ? response200.content : {};
      const jsonContent = isRecord(content['application/json']) ? content['application/json'] : {};

      resources.push({
        url,
        path,
        method: method.toUpperCase(),
        title: readString(agentDiscovery?.title),
        summary: readString(operation.summary),
        description: readString(agentDiscovery?.description) ?? readString(operation.description),
        category: readString(agentDiscovery?.category),
        providerName: readString(agentDiscovery?.providerName),
        providerUrl: readString(agentDiscovery?.providerUrl),
        price: priceFromPaymentInfo(paymentInfo),
        priceUsd: readString(agentDiscovery?.priceUsd),
        accepts: [],
        metadata: {
          operationId: readString(operation.operationId),
          protocols: asArray(paymentInfo?.protocols),
        },
        input: operation.parameters,
        output: jsonContent.schema,
      });
    }
  }

  return {
    origin: origin.origin,
    source: 'openapi',
    openapiUrl,
    wellKnownUrl: resolveUrl(xDiscovery.wellKnownX402, origin),
    catalogUrl: resolveUrl(xDiscovery.catalog, origin),
    accepts: [],
    resources,
    info: {
      title: readString(info.title),
      description: readString(info.description),
      version: readString(info.version),
      guidance: readString(info['x-guidance']),
    },
    ownershipProofs: asArray(xDiscovery.ownershipProofs).filter(
      (proof): proof is string => typeof proof === 'string',
    ),
  };
}

/**
 * Discover paid x402 resources exposed by an origin.
 *
 * The helper prefers the conventional `/.well-known/x402` manifest and falls
 * back to OpenAPI metadata at `/openapi.json`. It performs metadata discovery
 * only; use `client.fetch(resource.url)` to trigger the normal 402 payment flow.
 */
export async function discoverX402Origin(
  originInput: string | URL,
  options: X402DiscoveryOptions = {},
): Promise<X402DiscoveryResult> {
  const origin = normalizeOrigin(originInput);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('discoverX402Origin requires a fetch implementation.');
  }

  const errors: string[] = [];
  const wellKnownUrl = new URL('/.well-known/x402', origin).href;
  const wellKnown = await fetchJson(fetchImpl, wellKnownUrl);
  if (wellKnown.ok) {
    const parsed = parseWellKnownX402(wellKnown.data, origin, wellKnownUrl);
    if (parsed && parsed.resources.length > 0) return parsed;
    errors.push(`${wellKnownUrl}: no x402 resources found`);
  } else {
    errors.push(`${wellKnownUrl}: ${wellKnown.error}`);
  }

  const openapiUrl = new URL('/openapi.json', origin).href;
  const openapi = await fetchJson(fetchImpl, openapiUrl);
  if (openapi.ok) {
    const parsed = parseOpenApi(openapi.data, origin, openapiUrl);
    if (parsed && parsed.resources.length > 0) return parsed;
    errors.push(`${openapiUrl}: no paid OpenAPI resources found`);
  } else {
    errors.push(`${openapiUrl}: ${openapi.error}`);
  }

  throw new Error(`Unable to discover x402 resources for ${origin.origin}. ${errors.join('; ')}`);
}
