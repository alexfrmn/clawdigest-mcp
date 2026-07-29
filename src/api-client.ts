export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export class ClawDigestApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfter?: number;

  constructor(input: {
    status: number;
    code: string;
    retryable?: boolean;
    retryAfter?: number;
  }) {
    super(`ClawDigest API request failed (${input.status}: ${input.code})`);
    this.name = 'ClawDigestApiError';
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.retryAfter = input.retryAfter;
  }
}

export function readApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  const apiKey = String(env.CLAWDIGEST_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'CLAWDIGEST_API_KEY is required. Create one at https://clawdigest.live/account.',
    );
  }
  const baseUrl = String(
    env.CLAWDIGEST_API_BASE_URL || 'https://clawdigest.live',
  ).trim().replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('CLAWDIGEST_API_BASE_URL must use http or https.');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('CLAWDIGEST_API_BASE_URL must not contain credentials or a fragment.');
  }
  if (
    parsed.protocol !== 'https:'
    && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  ) {
    throw new Error('CLAWDIGEST_API_BASE_URL must use https outside localhost.');
  }
  return { baseUrl, apiKey };
}

export function createApiClient(
  config: ApiConfig,
  fetchImpl: typeof fetch = fetch,
) {
  async function request(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<any> {
    const url = new URL(path, `${config.baseUrl}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'clawdigest-mcp/2.0',
          'x-api-key': config.apiKey,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ClawDigestApiError({
        status: 503,
        code: 'api_unavailable',
        retryable: true,
      });
    }
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new ClawDigestApiError({
        status: response.status,
        code: String(body?.error?.code || `http_${response.status}`),
        retryable: Boolean(body?.error?.retryable),
        retryAfter: Number(body?.error?.retry_after || response.headers.get('retry-after')) || undefined,
      });
    }
    return body;
  }

  return {
    latest(input: {
      source?: string;
      category?: string;
      region?: string;
      sort?: 'date' | 'score';
      limit?: number;
      cursor?: string;
    } = {}) {
      return request('/api/v2/items', input);
    },
    search(input: {
      query: string;
      region?: string;
      sort?: 'date' | 'score';
      limit?: number;
    }) {
      return request('/api/v2/search', {
        q: input.query,
        region: input.region,
        sort: input.sort,
        limit: input.limit,
      });
    },
    sources: () => request('/api/v2/sources'),
    trending: (input: { hours?: number; limit?: number } = {}) => (
      request('/api/v2/trending', input)
    ),
    regions: () => request('/api/v2/regions'),
    status: () => request('/api/v2/status'),
    usage: () => request('/api/v2/usage'),
  };
}
