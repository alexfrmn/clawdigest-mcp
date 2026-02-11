#!/usr/bin/env node
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const CLAWDIGEST_URL = (process.env.CLAWDIGEST_URL || 'https://clawdigest.live').replace(/\/$/, '');
const cliPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : undefined;
const PORT = Number(process.env.PORT || cliPort || 8788);
const USER_AGENT = 'clawdigest-mcp/1.0 (+https://clawdigest.live)';

async function api(path: string, query: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const url = `${CLAWDIGEST_URL}${path}${qs.size ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
  return res.json();
}

function makeServer() {
  const server = new McpServer({ name: 'clawdigest-mcp', version: '1.0.0' });

  server.registerTool('clawdigest_latest', {
    title: 'Latest items',
    description: 'Get latest/top ClawDigest items with filters and pagination.',
    inputSchema: {
      source: z.string().optional(),
      category: z.string().optional(),
      region: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      sort: z.enum(['score', 'date']).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    },
  }, async (args) => {
    const data = await api('/api/items', args as any);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
  });

  server.registerTool('clawdigest_search', {
    title: 'Search items',
    description: 'Search ClawDigest items by query string.',
    inputSchema: {
      q: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async (args) => {
    const data = await api('/api/search', args as any);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
  });

  server.registerTool('clawdigest_trending', {
    title: 'Trending items',
    description: 'Get trending ClawDigest items for a recent window.',
    inputSchema: {
      hours: z.number().int().min(1).max(168).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      region: z.string().optional(),
      category: z.string().optional(),
    },
  }, async (args) => {
    const data = await api('/api/trending', args as any);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
  });

  server.registerTool('clawdigest_sources', {
    title: 'Sources',
    description: 'List ClawDigest source catalog.',
    inputSchema: {
      region: z.string().optional(),
    },
  }, async (args) => {
    const data: any = await api('/api/sources');
    if (args.region) {
      const region = String(args.region).toLowerCase();
      data.sources = (data.sources || []).filter((s: any) => String(s.region || 'us').toLowerCase().includes(region));
      data.count = data.sources.length;
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
  });

  server.registerTool('clawdigest_article', {
    title: 'Get one article',
    description: 'Fetch a single article by id or URL.',
    inputSchema: {
      id: z.number().int().positive().optional(),
      url: z.string().url().optional(),
    },
  }, async (args) => {
    if (!args.id && !args.url) throw new Error('id or url is required');
    const data = await api('/api/article', args as any);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

let transport: StreamableHTTPServerTransport | null = null;
let server: McpServer | null = null;

app.all('/mcp', async (req, res) => {
  try {
    if (!transport) {
      server = makeServer();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'mcp_error' });
  }
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('clawdigest-mcp up. Use /mcp for Streamable HTTP (SSE-compatible).');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`clawdigest-mcp listening on :${PORT} (MCP 2024-11-05 Streamable HTTP/SSE)`);
});
