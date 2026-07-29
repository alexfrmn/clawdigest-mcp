import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

let apiServer: HttpServer;
let baseUrl = '';

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string'
    )),
  );
}

function createTransport() {
  return new StdioClientTransport({
    command: process.execPath,
    args: [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      join(process.cwd(), 'src/mcp-server.ts'),
    ],
    env: {
      ...inheritedEnv(),
      CLAWDIGEST_API_BASE_URL: baseUrl,
      CLAWDIGEST_API_KEY: 'cd_live_stdio_test',
    },
    cwd: process.cwd(),
    stderr: 'pipe',
  });
}

beforeAll(async () => {
  apiServer = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers['x-api-key'] !== 'cd_live_stdio_test') {
      res.statusCode = 401;
      res.end(JSON.stringify({
        ok: false,
        error: { code: 'invalid_api_key', retryable: false },
      }));
      return;
    }
    if (req.url?.startsWith('/api/v2/items')) {
      res.end(JSON.stringify({
        ok: true,
        items: [{ id: 7, title: 'MCP stdio item' }],
        meta: { plan: 'free', count: 1 },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({
      ok: false,
      error: { code: 'not_found', retryable: false },
    }));
  });
  await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    apiServer.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('ClawDigest MCP stdio protocol compatibility', () => {
  it('continues to serve legacy initialization clients', async () => {
    const transport = createTransport();
    const client = new Client({ name: 'clawdigest-legacy-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe('legacy');
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('clawdigest_latest');
    } finally {
      await client.close();
    }
  }, 20_000);

  it('negotiates MCP 2026-07-28 and calls an authenticated tool', async () => {
    const transport = createTransport();
    const client = new Client(
      { name: 'clawdigest-modern-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 2_000 } } },
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe('modern');
      const result = await client.callTool({
        name: 'clawdigest_latest',
        arguments: { limit: 1 },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content[0].text || '{}')).toMatchObject({
        ok: true,
        items: [{ title: 'MCP stdio item' }],
      });
    } finally {
      await client.close();
    }
  }, 20_000);
});
