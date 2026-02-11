# clawdigest-mcp

MCP server for [ClawDigest](https://clawdigest.live) AI news aggregator.

## Install (Claude Code)

```bash
claude mcp add clawdigest -- npx clawdigest-mcp
```

Or in settings JSON:

```json
{"mcpServers":{"clawdigest":{"command":"npx","args":["clawdigest-mcp"]}}}
```

## HTTP mode (hosted)

```bash
npx clawdigest-mcp --http --port 8788
```

## Tools

| Tool | Description |
|------|-------------|
| clawdigest_latest | Latest/top items with filters |
| clawdigest_search | Search by query |
| clawdigest_sources | Source catalog |
| clawdigest_trending | Trending topics |
| clawdigest_article | Extract article text by URL |
