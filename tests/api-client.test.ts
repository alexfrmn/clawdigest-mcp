import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ClawDigestApiError,
  createApiClient,
  readApiConfig,
} from '../src/api-client.js';

let server: Server;
let baseUrl = '';
let lastHeader = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeader = String(req.headers['x-api-key'] || '');
    res.setHeader('content-type', 'application/json');
    if (lastHeader !== 'cd_live_test') {
      res.statusCode = 401;
      res.end(JSON.stringify({
        ok: false,
        error: { code: 'invalid_api_key', retryable: false },
      }));
      return;
    }
    res.end(JSON.stringify({
      ok: true,
      items: [{ title: 'Remote MCP item' }],
      meta: { plan: 'free' },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('ClawDigest API client', () => {
  it('sends the account key only in the header', async () => {
    const client = createApiClient({ baseUrl, apiKey: 'cd_live_test' });
    await expect(client.latest({ limit: 1 })).resolves.toMatchObject({
      ok: true,
      items: [{ title: 'Remote MCP item' }],
    });
    expect(lastHeader).toBe('cd_live_test');
  });

  it('returns structured safe errors', async () => {
    const client = createApiClient({ baseUrl, apiKey: 'cd_live_bad_secret' });
    await expect(client.latest()).rejects.toMatchObject({
      name: 'ClawDigestApiError',
      status: 401,
      code: 'invalid_api_key',
    });
    try {
      await client.latest();
    } catch (error) {
      expect(error).toBeInstanceOf(ClawDigestApiError);
      expect(String(error)).not.toContain('cd_live_bad_secret');
    }
  });

  it('requires a key and https outside localhost', () => {
    expect(() => readApiConfig({})).toThrow(/CLAWDIGEST_API_KEY/);
    expect(() => readApiConfig({
      CLAWDIGEST_API_KEY: 'cd_live_test',
      CLAWDIGEST_API_BASE_URL: 'http://example.com',
    })).toThrow(/https/);
    expect(readApiConfig({
      CLAWDIGEST_API_KEY: 'cd_live_test',
      CLAWDIGEST_API_BASE_URL: `${baseUrl}/`,
    })).toEqual({ apiKey: 'cd_live_test', baseUrl });
  });
});
