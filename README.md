# clawdigest-mcp

Authenticated stdio MCP sidecar for the
[ClawDigest](https://clawdigest.live) account API.

## Setup

1. Sign in at [clawdigest.live/account](https://clawdigest.live/account).
2. Create a named API key and copy it when shown.
3. Configure the sidecar:

```bash
claude mcp add clawdigest \
  -e CLAWDIGEST_API_KEY=cd_live_... \
  -- npx -y clawdigest-mcp
```

JSON:

```json
{
  "mcpServers": {
    "clawdigest": {
      "command": "npx",
      "args": ["-y", "clawdigest-mcp"],
      "env": {
        "CLAWDIGEST_API_KEY": "cd_live_..."
      }
    }
  }
}
```

For a local/self-hosted API, set `CLAWDIGEST_API_BASE_URL`. Non-HTTPS base
URLs are accepted only for localhost. The key is sent only in the
`X-API-Key` header.

## Tools

| Tool | Description |
|---|---|
| `clawdigest_latest` | Latest or top-ranked entitled items |
| `clawdigest_search` | Search entitled items |
| `clawdigest_sources` | Configured source catalog |
| `clawdigest_trending` | Recent high-signal items |
| `clawdigest_regions` | Regions within the archive entitlement |
| `clawdigest_status` | Tracked AI-service status |
| `clawdigest_usage` | Current plan, quota, and usage |

Version 2 removes the unauthenticated hosted HTTP mode and arbitrary article
URL fetcher. This closes the previous open-proxy/SSRF surface and makes REST
and MCP share one account entitlement and quota.

## Development and release checks

```bash
npm ci
npm test
npm run build
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

The package is stdio-only. Its release archive intentionally contains only the
README, compiled client/server files, and package metadata.
