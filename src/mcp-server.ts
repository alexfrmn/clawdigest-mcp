#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Server, type Tool } from '@modelcontextprotocol/server';
import {
  ClawDigestApiError,
  createApiClient,
  readApiConfig,
} from './api-client.js';

type ApiClient = ReturnType<typeof createApiClient>;

const tools: Tool[] = [
  {
    name: 'clawdigest_latest',
    description: 'Get the latest or highest-scored entitled ClawDigest news items.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string' },
        category: { type: 'string' },
        region: { type: 'string' },
        sort: { type: 'string', enum: ['date', 'score'] },
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
    },
  },
  {
    name: 'clawdigest_search',
    description: 'Search entitled ClawDigest items by title.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        region: { type: 'string' },
        sort: { type: 'string', enum: ['date', 'score'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'clawdigest_sources',
    description: 'List configured ClawDigest sources.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'clawdigest_trending',
    description: 'Get high-signal items from a recent time window.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hours: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'clawdigest_regions',
    description: 'List regions in the entitled archive window.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'clawdigest_status',
    description: 'Get cached status for tracked AI services.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'clawdigest_usage',
    description: 'Get the plan, usage, and enforced REST/MCP limits.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function dispatch(client: ApiClient, name: string, args: any) {
  if (name === 'clawdigest_latest') return textResult(await client.latest(args));
  if (name === 'clawdigest_search') {
    return textResult(await client.search({
      query: String(args.query || ''),
      region: args.region,
      sort: args.sort,
      limit: args.limit,
    }));
  }
  if (name === 'clawdigest_sources') return textResult(await client.sources());
  if (name === 'clawdigest_trending') return textResult(await client.trending(args));
  if (name === 'clawdigest_regions') return textResult(await client.regions());
  if (name === 'clawdigest_status') return textResult(await client.status());
  if (name === 'clawdigest_usage') return textResult(await client.usage());
  throw new Error(`Unknown tool: ${name}`);
}

export function createServer(client: ApiClient): Server {
  const server = new Server(
    { name: 'clawdigest-mcp', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler('tools/list', async () => ({
    tools: tools.map((tool) => ({ ...tool })),
  }));
  server.setRequestHandler('tools/call', async (request) => {
    try {
      return await dispatch(client, request.params.name, request.params.arguments || {});
    } catch (error) {
      const payload = error instanceof ClawDigestApiError
        ? {
            ok: false,
            error: {
              code: error.code,
              status: error.status,
              retryable: error.retryable,
              ...(error.retryAfter ? { retry_after: error.retryAfter } : {}),
            },
          }
        : {
            ok: false,
            error: { code: 'mcp_tool_failed', status: 500, retryable: false },
          };
      return { ...textResult(payload), isError: true };
    }
  });
  server.setRequestHandler('resources/list', async () => ({
    resources: [{
      uri: 'clawdigest://latest',
      name: 'Latest ClawDigest items',
      mimeType: 'application/json',
    }],
  }));
  server.setRequestHandler('resources/read', async (request) => {
    if (request.params.uri !== 'clawdigest://latest') {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const payload = await client.latest({ limit: 10 });
    return {
      contents: [{
        uri: 'clawdigest://latest',
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      }],
    };
  });
  return server;
}

async function main() {
  const client = createApiClient(readApiConfig());
  await serveStdio(() => createServer(client));
}

await main();
