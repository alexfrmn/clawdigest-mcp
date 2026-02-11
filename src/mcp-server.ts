#!/usr/bin/env node
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

const CLAWDIGEST_URL = (process.env.CLAWDIGEST_URL || 'https://clawdigest.live').replace(/\/$/, '');
const USER_AGENT = 'clawdigest-mcp/1.0 (+https://clawdigest.live)';
const cliPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : undefined;
const PORT = Number(process.env.PORT || cliPort || 8788);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'into', 'from', 'to', 'of', 'in', 'on', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'as', 'new', 'after', 'over', 'under',
  'via', 'how', 'why', 'what', 'when', 'where', 'can', 'will', 'its', 'their', 'your', 'our', 'about',
  'says', 'said', 'could', 'would', 'also', 'just', 'get', 'got', 'has', 'have', 'had', 'may', 'might',
  'much', 'more', 'most', 'some', 'than', 'them', 'then', 'these', 'they', 'very', 'want', 'year', 'years',
  'first', 'last', 'still', 'back', 'down', 'make', 'made', 'takes', 'turns', 'launches', 'gets', 'looks',
  'comes', 'goes', 'shows', 'finds', 'keeps', 'lets', 'puts', 'runs', 'sets', 'tells', 'uses', 'wants', 'works',
]);

type DigestItem = {
  id?: number;
  title?: string;
  url?: string;
  source_id?: string;
  source?: string;
  published_at?: string;
  score?: number;
};

async function fetchJson(path: string, query: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const url = `${CLAWDIGEST_URL}${path}${qs.size ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);
  return res.text();
}

function decodeEntities(text: string): string {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTerms(title: string): string[] {
  const words = decodeEntities(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const result: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    result.push(`${words[i]} ${words[i + 1]}`);
  }

  for (const w of words) {
    if (w.length >= 5) result.push(w);
  }

  return result;
}

function deriveTrendingTopics(items: DigestItem[], topN = 10) {
  const byKeyword = new Map<string, DigestItem[]>();

  for (const it of items) {
    const seen = new Set<string>();
    for (const kw of extractTerms(String(it.title || ''))) {
      if (seen.has(kw)) continue;
      seen.add(kw);
      if (!byKeyword.has(kw)) byKeyword.set(kw, []);
      byKeyword.get(kw)!.push(it);
    }
  }

  const topics = Array.from(byKeyword.entries())
    .map(([topic, grouped]) => {
      const sorted = [...grouped].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      return {
        topic,
        mention_count: grouped.length,
        top_articles: sorted.slice(0, 5).map((it) => ({
          title: it.title,
          url: it.url,
          source: it.source_id || it.source,
          published_at: it.published_at,
          score: it.score,
        })),
      };
    })
    .filter((t) => t.mention_count >= 3)
    .sort((a, b) => {
      if (b.mention_count !== a.mention_count) return b.mention_count - a.mention_count;
      const bs = Number(b.top_articles[0]?.score || 0);
      const as = Number(a.top_articles[0]?.score || 0);
      return bs - as;
    })
    .slice(0, topN);

  return topics;
}

async function parseArticle(url: string) {
  const html = await fetchText(url);

  let title = '';
  let content = '';
  let source = '';
  let publishedAt = '';

  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    title = parsed?.title || '';
    content = parsed?.textContent?.trim() || '';
    source = parsed?.siteName || '';
  } catch {
    // fallback below
  }

  const $ = cheerio.load(html);
  if (!title) {
    title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text().trim() ||
      '';
  }

  if (!source) {
    source =
      $('meta[property="og:site_name"]').attr('content') ||
      new URL(url).hostname.replace(/^www\./, '') ||
      '';
  }

  publishedAt =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[name="date"]').attr('content') ||
    $('time[datetime]').first().attr('datetime') ||
    '';

  if (!content) {
    const bodyText =
      $('article').text().trim() ||
      $('main').text().trim() ||
      $('body').text().trim() ||
      '';
    content = bodyText.replace(/\s+/g, ' ').trim();
  }

  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;

  return {
    title,
    content,
    source,
    published_at: publishedAt || null,
    word_count: wordCount,
  };
}

function makeServer() {
  const server = new McpServer({ name: 'clawdigest-mcp', version: '1.0.0' });

  server.registerTool(
    'clawdigest_latest',
    {
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
    },
    async (args) => {
      const data = await fetchJson('/api/items', args as any);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  server.registerTool(
    'clawdigest_search',
    {
      title: 'Search items',
      description: 'Search ClawDigest items by query string.',
      inputSchema: {
        q: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const data = await fetchJson('/api/search', args as any);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  server.registerTool(
    'clawdigest_sources',
    {
      title: 'Sources',
      description: 'List ClawDigest source catalog.',
      inputSchema: {
        region: z.string().optional(),
      },
    },
    async (args) => {
      const data: any = await fetchJson('/api/sources');
      if (args.region) {
        const region = String(args.region).toLowerCase();
        data.sources = (data.sources || []).filter((s: any) => String(s.region || 'us').toLowerCase().includes(region));
        data.count = data.sources.length;
      }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  server.registerTool(
    'clawdigest_trending',
    {
      title: 'Trending topics',
      description: 'Get topic-level trending aggregates with mention_count and top_articles.',
      inputSchema: {
        hours: z.number().int().min(1).max(168).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        region: z.string().optional(),
        category: z.string().optional(),
      },
    },
    async (args) => {
      const hours = Number(args.hours || 24);
      const fetchLimit = Math.max(50, Math.min(Number(args.limit || 20) * 10, 300));

      let items: DigestItem[] = [];
      try {
        const direct = await fetchJson('/api/trending', { ...args, hours, limit: fetchLimit } as any);
        items = Array.isArray(direct?.items) ? direct.items : [];
      } catch {
        const fallback = await fetchJson('/api/items', {
          ...args,
          limit: fetchLimit,
          sort: 'score',
          sinceHours: hours,
        } as any);
        items = Array.isArray(fallback?.items) ? fallback.items : [];
      }

      const topics = deriveTrendingTopics(items, Number(args.limit || 20));
      const data = { hours, count: topics.length, topics };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  server.registerTool(
    'clawdigest_article',
    {
      title: 'Fetch article by URL',
      description: 'Fetch an article URL and extract readable text and metadata.',
      inputSchema: {
        url: z.string().url(),
      },
    },
    async (args) => {
      const data = await parseArticle(String(args.url));
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  return server;
}

const args = process.argv.slice(2);
const httpMode = args.includes('--http');

async function main() {
  if (httpMode) {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    let transport: StreamableHTTPServerTransport | null = null;
    let server: McpServer | null = null;

    app.all('/mcp', async (req, res) => {
      try {
        if (!transport) {
          server = makeServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          await server.connect(transport);
        }
        await transport.handleRequest(req, res, req.body);
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || 'mcp_error' });
      }
    });

    app.get('/', (_req, res) => {
      res.type('text/plain').send('clawdigest-mcp up. POST /mcp for MCP.');
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`clawdigest-mcp HTTP on :${PORT}`);
    });
  } else {
    const server = makeServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error('[clawdigest-mcp] fatal', err);
  process.exit(1);
});
