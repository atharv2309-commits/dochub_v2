# DocHub — Application Handoff & Feature Overview

> A self-hosted, GitBook-style documentation platform for FlytBase: an **admin CMS** for authoring,
> a **public SSR docs site** for readers, **AI search**, **automated machine translation** into 13
> languages, **branded PDF export**, and **MCP servers** so AI agents can read and write the docs.
> Built on Next.js 16 + Supabase. Everything described here is on the `main` branch.

---

## 1. What DocHub Is

DocHub replaces a hosted GitBook with an owned, extensible stack. It has **three surfaces** over one Postgres database:

| Surface | Who uses it | Path |
|---|---|---|
| **Admin CMS** | Internal authors/editors (authenticated) | `/admin/*` |
| **Public docs** | End users / customers (anonymous, SEO-indexed) | `/{lang}/docs/*` |
| **MCP servers** | AI agents (Claude, Cursor, …) | `/api/mcp`, `/api/mcp/admin` |

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack). Uses `proxy.ts` (not `middleware.ts`) and `getClaims()` auth. |
| Database / Auth / Storage | **Supabase** (Postgres + RLS, Supabase Auth, Storage buckets) |
| Schema management | **Declarative SQL** (`supabase/schemas/*.sql`) → migrations via `supabase db diff`; typed clients via `supabase gen types` (`npm run db:types`) |
| Editor | **BlockNote** v0.51 (`@blocknote/shadcn`, `+ xl-multi-column`) |
| Styling / UI | **Tailwind v4** + **shadcn/ui**, Inter font, FlytBase brand theme, light/dark via `next-themes` |
| Code highlighting | **Shiki** (server-side, `github-dark`) |
| AI search | **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`) — model **`gpt-4o-mini`** |
| Translation engine | **`google-translate-api-x`** (pluggable interface) |
| PDF | **Puppeteer-core + @sparticuz/chromium** (serverless Chromium) |
| MCP | **`mcp-handler`** (streamable HTTP) |
| Drag & drop | `@dnd-kit` |
| Deployment | **Vercel** (app) + **Supabase** (managed Postgres) |

---

## 3. Feature Catalog

### A. Admin CMS & Authoring Workflow
- **Auth**: Supabase email/password. A project is owned by one `user_id`. `proxy.ts` guards every `/admin/*` route (redirect to `/auth/login?redirectTo=…`); the admin layout double-checks the session. Public docs and home are unguarded.
- **Dashboard** (`/admin`): stat cards (Projects, Total Pages, Published, Pending Review) + recent-activity feed + project cards.
- **Projects & page tree**: nested pages via `parent_id`; three page kinds — `document`, `group` (folder), `link` (external). **Drag-to-reorder** within a parent (DnD Kit, fractional `order_index`).
- **Page settings**: emoji icon, cover image, tags, `hidden` (drop from nav), `no_index` (SEO) — applied immediately.
- **Draft → Review → Publish**: the page row carries both `content` (live, public reads this only) and `draft_content`/`draft_title`/`draft_description` (pending edits). Editing writes the draft; **`publish_page()` RPC** promotes draft→live, regenerates slug if needed, cascades path changes to children, snapshots a version, and **enqueues translation jobs**. A **Drafts review queue** (`/admin/drafts`) lists never-published + pending-changes pages.
- **Version history**: every publish snapshots an immutable row (`page_versions`); `restore_page_version()` rolls back by branching forward (history never deleted).

### B. Content Editor (BlockNote)
- Rich block editor with standard blocks plus **custom blocks**: **Callout** (info/warning/danger/success), **Embed** (YouTube/Vimeo/Loom iframes + native MP4/WebM video), **Multi-column** layouts (`xl-multi-column`), tables, Shiki-ready code blocks, images.
- **Image upload** goes straight to Supabase Storage (`images` bucket, path `pages/{pageId}/{ts}.{ext}`), returns a public URL.

### C. GitBook Import Pipeline
- Two importers: **high-fidelity GitBook document-JSON** (`lib/import/gitbookDocToBlocks.ts`) preserving tables, image widths, grouped images→columns, hints→callouts, code, nested lists, links; and a **markdown** importer.
- **Media self-hosting**: every GitBook image/embed is downloaded and re-hosted to Supabase (`imported/{projectId}/{fileId}.{ext}`), **deduped by file ID**, ≤25 MB (else hot-linked).
- **GIF→MP4 transcoding** (`lib/import/gifToVideo.ts`, ffmpeg): GIFs ≥3 MB become H.264 MP4 video blocks for performance.
- Run via `npx tsx scripts/import-gitbook.ts [projectSlug]` (needs `GITBOOK_API_TOKEN`, `GITBOOK_SPACE_ID`, service-role key).

### D. Public Docs Site (SSR)
- **`BlockRenderer`** renders every block type: headings (with TOC anchors), lists, code (Shiki + copy button), images (authored widths, lazy-load), columns, embeds, callouts, quotes, dividers, tables.
- **Table of Contents** with scroll-spy (IntersectionObserver), **prev/next** navigation, **responsive** sidebar (static desktop / slide-in drawer mobile), **light/dark** toggle.
- Cached, cookieless data layer (`lib/docs/cache.ts`) — project + page tree + per-locale translation are `unstable_cache`'d and shared across pages/locales (fast language switches).

### E. Search & "Ask AI"
- **Command palette** (Cmd/Ctrl-K): instant client-side fuzzy filter (title-weighted), top 8 results.
- **Ask AI**: streaming RAG answers via **`gpt-4o-mini`**. Retrieval is **Postgres full-text search** (not embeddings): the `ai_search_fts` migration adds a `blocknote_text()` flattener, a weighted **generated `search_vector`** column (title=A, description=B, body=C), a **GIN index**, and a `search_pages()` RPC. Answers stream with **inline citations** to the exact doc pages used.

### F. Translation / Internationalization (i18n)
The largest subsystem. Translates both **page content** and **UI chrome** into **13 target languages** (en source + es, fr, de, pt, nl, el, sk, lv, it, ja, zh, ko, ar — incl. **RTL Arabic** and **CJK**).
- **Routing**: `/{lang}/docs/...`; `proxy.ts` resolves locale (path → `NEXT_LOCALE` cookie → `Accept-Language`) and sets `<html lang dir>`.
- **Content pipeline** (`lib/translation/*`): block-aware **extract → translation-memory lookup → translate only changed segments → reassemble**, preserving structure/code/links. A **`source_hash`** detects staleness; **translation memory** makes re-translation cheap and consistent. Translations are **derived artifacts** — the English source is the single source of truth, and the system self-heals on edits.
- **Pluggable engine** behind a `TranslationEngine` interface (`google-translate-api-x` default; swappable to Google Cloud / DeepL / Claude in one file).
- **Async jobs + worker**: publishing enqueues `translation_jobs`; a Node worker route (`/api/translation/worker`) drains them with atomic claims, retries, **stale-running self-healing**, a Hobby-safe time budget, and self-chaining. Triggered on publish and from the console.
- **Admin console** (`/admin/translations`): every project shows **all languages** as clickable cards with coverage; clicking opens a confirm dialog to **translate only missing/out-of-date pages** (the cost optimization) or re-translate all; per-page status widget in the editor; job log.
- **Bulk tooling**: `npm run translate:all` (resumable, rate-limit-aware, set-and-walk-away) with a `status` sub-command; `npm run translate:ui` regenerates the UI dictionaries.
- **UI chrome localization**: keyed JSON dictionaries (`lib/i18n/dictionaries/*.json`) resolved **on the server** (SSR), so localized nav/search/buttons are in the indexed HTML — fully SEO-safe, zero client-side translation flicker.
- **Instant-feel switching**: `loading.tsx` skeleton, transition-based switcher with spinner + prefetch, and the shared cached data layer.

### G. PDF Export
- Any published page exports as a **branded PDF** (FlytBase cover, running header/footer, page numbers). Nested child pages are appended as **labelled appendices**. Videos render as clickable poster thumbnails.
- Implementation reuses the real renderer via a hidden `/print/*` route + headless Chromium (`puppeteer-core` + `@sparticuz/chromium`), deploy-safe on Vercel (binary force-included in the function trace).

### H. MCP Servers (AI-agent access)
- **Public server** `POST /api/mcp` — anonymous, read-only. Tools: `list_projects`, `search_docs`, `list_pages`, `get_page` (returns Markdown). Per-IP rate limit.
- **Admin server** `POST /api/mcp/admin` — Bearer API key, full read/write for headless automation. Tools include `create_page`, `update_page`, `set_page_settings`, `rename_page`, `publish_page`, `delete_page`, plus discovery/draft tools.
- **API keys**: `dhk_*` keys minted in `/admin/mcp` (shown once), stored as SHA-256 hashes in `mcp_api_keys`, revocable; every call is recorded in an append-only `mcp_audit_log`.
- **Connection UI**: public **MCP dialog** in the docs header + admin key manager, both generating ready-to-paste snippets for **Claude Code, Claude Desktop, Cursor, VS Code**, or raw URL.

### I. SEO
- Per-locale URLs, correct `<html lang dir>`, **hreflang** alternates (+ `x-default`), per-locale canonical, localized `<title>`/description and OpenGraph/Twitter tags, dynamic **sitemap** (every page × locale) and **robots.txt**.

---

## 4. Database (Supabase)

**Tables**: `projects`, `pages` (with `content`/`draft_content`, `status`, `kind`, `order_index`, `tags`, `hidden`, `no_index`, `enabled_locales` on projects), `page_versions`, `page_translations`, `translation_memory`, `translation_jobs`, `mcp_api_keys`, `mcp_audit_log`. Plus a generated `search_vector` on `pages`.

**Key RPCs (SECURITY DEFINER)**: `publish_page`, `create_page_version`, `restore_page_version`, `rename_page`, `enqueue_page_translations`, `request_translations`, `request_page_translations`, `set_translation_reviewed`, `search_pages`, and `mcp_*` wrappers.

**Security**: Row-Level Security throughout — owners manage their own data; anon can read only published, non-hidden pages (and their translations) in public projects; worker/MCP writes use the service-role key or owner-checked SECURITY DEFINER functions.

**Storage**: public `images` bucket (25 MB limit, images + transcoded video MIME types).

10 migrations under `supabase/migrations/` (initial schema → storage → versions → drafts → media → AI FTS → translations → MCP).

---

## 5. Deployment & Operations

**Hosting**: Vercel (app) + Supabase (Postgres/Auth/Storage).

**Required environment variables**
| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker / import / MCP-admin (server-only) |
| `NEXT_PUBLIC_SITE_URL` | Canonical/sitemap/OG absolute URLs |
| `TRANSLATION_WORKER_SECRET` | **Required** — auth for the translation worker (no translations without it) |
| `OPENAI_API_KEY` | "Ask AI" (gpt-4o-mini) |
| `TRANSLATION_ENGINE` | Optional; defaults to `google-free` |
| `GITBOOK_API_TOKEN` / `GITBOOK_SPACE_ID` | One-time content import only |
| `PUPPETEER_SKIP_DOWNLOAD=true` | Skip full Chrome download in Vercel builds |

**npm scripts**: `dev`, `build`, `db:types` (regen Supabase types), `translate:all`, `translate:ui`.

**DB workflow**: edit `supabase/schemas/*.sql` → `supabase db diff -f <name>` → `supabase db push` → `npm run db:types`.

---

## 6. Engineering Highlights (talking points for the presentation)
- **One source of truth, derived everything**: translations and PDFs are *generated* from the English source; the system self-heals on edits via content hashing + translation memory.
- **SEO-first i18n**: chrome and content are server-rendered per locale (not client-swapped), so every language is fully crawlable — uncommon and hard to retrofit.
- **Pluggable translation engine** + **resumable bulk tooling** that survived translating ~1,900 page-locales unattended.
- **Resilient job system**: atomic claims, retries, self-healing stale jobs, never destroys a good translation, never 404s (falls back to English with a notice).
- **AI-native**: both an in-docs AI assistant (RAG over Postgres FTS) and MCP servers that let external agents read *and* author docs with audited API keys.
- **Deploy-hardened**: serverless Chromium for PDF, Hobby-safe worker time budgets, cookieless cached data layer for instant navigation.

## 7. Known Limitations / Future Work
- Free translation engine is an **unofficial endpoint** — fine at low volume (TM keeps requests minimal) and **pluggable**; swap to Google Cloud Translation/DeepL for production SLAs.
- **pg_cron** worker scheduler is written but **held** (`supabase/.held/`) — currently translations process on publish + manual trigger + self-chaining worker; enable cron as a backstop post-deploy.
- A few **in-body content links** from imported GitBook content are locale-less (proxy redirects them correctly anyway).
- MCP admin keys are **global scope** (no per-project scoping yet).
- Search retrieval is **FTS, not embeddings** — excellent for keyword/lexical matching; semantic search would be a future upgrade.
