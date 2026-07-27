# MCP servers

DocHub exposes two [Model Context Protocol](https://modelcontextprotocol.io) servers so AI agents can read and operate the docs. Both are Next.js route handlers (Vercel-hosted, **Streamable HTTP** transport).

| Server | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| **Public** | `POST /api/mcp` | none (anonymous) | Read-only "talk to the docs": search & read published, public content |
| **Admin** | `POST /api/mcp/admin` | `Authorization: Bearer <key>` | Headless write: create/edit/publish/delete pages |

## Public server (`/api/mcp`)

Read-only. Runs every query through the **anon** Supabase client, so Postgres RLS guarantees only `published`, non-`hidden` pages in `public` projects are ever reachable — the read-only guarantee comes from the database, not just from which tools are registered (no write tool exists on this server).

Tools:
- `list_projects` — discover public projects (slugs).
- `search_docs(query, project?, tag?, limit?)` — full-text search with highlighted snippets + citation URLs. Cross-project unless a slug is given.
- `list_pages(project, under_path?)` — navigation tree (titles + paths).
- `get_page(project, path)` — full page as Markdown, with a Source URL.

The server returns documentation content for the **calling** model to reason over; it does not run an LLM itself. Per-IP rate limited (~60 burst, 1/s).

## Admin server (`/api/mcp/admin`)

Authenticated with a bearer API key (`dhk_…`). Missing/invalid key → `401`; key lacking the `admin` scope → `403`. After auth it uses the **service-role** client and routes invariant-bearing writes (publish/rename/restore) through the `mcp_*` SECURITY DEFINER wrappers, which impersonate the project owner so attribution and the draft→review→publish rules are preserved. Every write is recorded in `mcp_audit_log`.

Tools: `list_projects`, `list_pages`, `list_drafts`, `get_page` (incl. `draft`), `create_page`, `update_page` (saves a draft), `set_page_settings`, `rename_page`, `publish_page`, `delete_page`.

> **Security:** an admin key is a **full-platform credential** — scope is global, so it can write any project (DocHub is a single-org install). Treat it like a root secret. To go multi-tenant, add an owner/project scope to `mcp_api_keys` and reject out-of-scope pages in the wrappers.

### Minting / rotating an admin key

```bash
npx tsx scripts/mint-mcp-key.ts "my agent label"
```

Prints the raw key **once** (only its SHA-256 hash is stored). Revoke by setting `revoked_at` on the `mcp_api_keys` row (or deleting it).

## Connecting a client

Add a remote MCP server pointing at the endpoint. Example (Claude Desktop / Cursor style):

```json
{
  "mcpServers": {
    "dochub-docs": { "url": "https://<your-site>/api/mcp" },
    "dochub-admin": {
      "url": "https://<your-site>/api/mcp/admin",
      "headers": { "Authorization": "Bearer dhk_..." }
    }
  }
}
```

## Deploy

The MCP support ships in migration `20260625000000_mcp.sql` (tables `mcp_api_keys`, `mcp_audit_log`; the `mcp_search_pages` RPC; and the `mcp_*` write wrappers). Apply with `npx supabase db push`. Pin the Vercel functions to the Supabase region to minimize query latency.

> Production hardening: front the anonymous `/api/mcp` with a WAF / distributed rate limit (Vercel WAF, Upstash) — the in-app limiter is per-instance, best-effort.
