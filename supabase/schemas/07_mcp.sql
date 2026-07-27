-- ──────────────────────────────────────────────────────────────────────────────
-- MCP (Model Context Protocol) server support.
--
-- Two MCP servers run inside the Next.js app (see app/api/mcp/*):
--   • public  — anonymous, READ-ONLY "talk to the docs" tools. Reads go through
--               the anon Supabase client so RLS guarantees only published, public,
--               non-hidden content is ever reachable. No tables here are needed
--               for it beyond the existing pages/projects + the search RPC below.
--   • admin   — API-key authed, WRITE tools that operate the platform headlessly.
--               Keys live in mcp_api_keys; every write is recorded in mcp_audit_log.
--
-- Admin writes reuse the existing draft→review→publish RPCs (publish_page,
-- rename_page, restore_page_version) WITHOUT modifying them: the mcp_* wrappers
-- below resolve the project owner and set the request.jwt.claims `sub` locally for
-- the transaction, so the underlying SECURITY DEFINER functions see the right
-- auth.uid() for their ownership checks and created_by/updated_by attribution.
-- ──────────────────────────────────────────────────────────────────────────────

-- SECURITY NOTE — admin key scope is intentionally GLOBAL. DocHub is a single-org
-- install, so an admin key grants full read/write across ALL projects (it acts as
-- each target project's owner). Treat an admin key as a full-platform superuser
-- credential. To support multi-tenant scoping later, add owner_user_id / allowed
-- project ids to mcp_api_keys and have the wrappers + tools reject out-of-scope pages.

-- 1. API keys for the admin MCP server. Only the secret's SHA-256 hash is stored;
--    the raw key is shown once at mint time (scripts/mint-mcp-key.ts) and never
--    persisted. RLS is enabled with NO policies, so only the service_role key
--    (used server-side by the MCP route) can read/write this table.
create table if not exists mcp_api_keys (
  id          uuid primary key default gen_random_uuid(),
  label       text,
  key_prefix  text,                       -- first chars of the raw key, for display only
  key_hash    text not null unique,       -- sha256(raw key), hex
  scopes      text[] not null default '{admin}',
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null
);

alter table mcp_api_keys enable row level security;

-- 2. Append-only audit log of admin MCP actions (who/what/which page/outcome).
create table if not exists mcp_audit_log (
  id           uuid primary key default gen_random_uuid(),
  key_id       uuid references mcp_api_keys(id) on delete set null,
  tool         text not null,
  project_slug text,
  page_path    text,
  args         jsonb,
  status       text not null default 'ok',  -- 'ok' | 'error'
  error        text,
  created_at   timestamptz not null default now()
);

alter table mcp_audit_log enable row level security;

create index if not exists mcp_audit_log_created_at_idx on mcp_audit_log (created_at desc);

-- 3. Enhanced search RPC for the public MCP "search_docs" tool.
--    Builds on the existing GENERATED search_vector + blocknote_text() (05_search.sql).
--    Differs from search_pages(): project slug is OPTIONAL (search across ALL public
--    projects when null), supports an optional tag filter, and returns a highlighted
--    text snippet (ts_headline) + rank so an agent gets grounded, citeable excerpts.
create or replace function mcp_search_pages(
  p_query        text,
  p_project_slug text default null,
  p_tag          text default null,
  p_limit        int  default 8
)
returns table (
  project_slug text,
  title        text,
  path         text,
  description  text,
  snippet      text,
  rank         real
)
language sql
stable
set search_path = public
as $$
  select
    pr.slug as project_slug,
    p.title,
    p.path,
    p.description,
    ts_headline(
      'english',
      blocknote_text(p.content),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MinWords=7, MaxWords=28, StartSel=**, StopSel=**, FragmentDelimiter= … '
    ) as snippet,
    ts_rank(p.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from pages p
  join projects pr on pr.id = p.project_id
  where pr.visibility = 'public'
    and p.status = 'published'
    and p.hidden = false
    and p.kind = 'document'
    and (p_project_slug is null or pr.slug = p_project_slug)
    and (p_tag is null or p_tag = any(p.tags))
    and p.search_vector @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(p.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit least(greatest(p_limit, 1), 25);
$$;

grant execute on function mcp_search_pages(text, text, text, int) to anon, authenticated;

-- 4. Admin write wrappers. Each resolves the owning user, impersonates it for the
--    duration of the transaction (set_config local), then delegates to the existing
--    RPC. Callable only by service_role (the MCP admin route's client).

create or replace function mcp_publish_page(p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select pr.user_id into v_owner
    from pages p join projects pr on pr.id = p.project_id
   where p.id = p_page_id;
  if v_owner is null then
    raise exception 'page % not found', p_page_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  -- Fail loud if impersonation didn't take effect, so a misconfiguration can never
  -- silently mis-attribute a write (or bypass the owner check via a NULL auth.uid()).
  if auth.uid() is distinct from v_owner then
    raise exception 'mcp impersonation failed to set actor';
  end if;
  perform publish_page(p_page_id);
end;
$$;

create or replace function mcp_rename_page(p_page_id uuid, p_title text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_path  text;
begin
  select pr.user_id into v_owner
    from pages p join projects pr on pr.id = p.project_id
   where p.id = p_page_id;
  if v_owner is null then
    raise exception 'page % not found', p_page_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  -- Fail loud if impersonation didn't take effect, so a misconfiguration can never
  -- silently mis-attribute a write (or bypass the owner check via a NULL auth.uid()).
  if auth.uid() is distinct from v_owner then
    raise exception 'mcp impersonation failed to set actor';
  end if;
  select rename_page(p_page_id, p_title) into v_path;
  return v_path;
end;
$$;

create or replace function mcp_restore_page_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_new   uuid;
begin
  select pr.user_id into v_owner
    from page_versions v join projects pr on pr.id = v.project_id
   where v.id = p_version_id;
  if v_owner is null then
    raise exception 'version % not found', p_version_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  -- Fail loud if impersonation didn't take effect, so a misconfiguration can never
  -- silently mis-attribute a write (or bypass the owner check via a NULL auth.uid()).
  if auth.uid() is distinct from v_owner then
    raise exception 'mcp impersonation failed to set actor';
  end if;
  select restore_page_version(p_version_id) into v_new;
  return v_new;
end;
$$;

create or replace function mcp_create_page_version(p_page_id uuid, p_change_summary text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_id    uuid;
begin
  select pr.user_id into v_owner
    from pages p join projects pr on pr.id = p.project_id
   where p.id = p_page_id;
  if v_owner is null then
    raise exception 'page % not found', p_page_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  -- Fail loud if impersonation didn't take effect, so a misconfiguration can never
  -- silently mis-attribute a write (or bypass the owner check via a NULL auth.uid()).
  if auth.uid() is distinct from v_owner then
    raise exception 'mcp impersonation failed to set actor';
  end if;
  select create_page_version(p_page_id, false, p_change_summary) into v_id;
  return v_id;
end;
$$;

revoke all on function mcp_publish_page(uuid)              from public, anon, authenticated;
revoke all on function mcp_rename_page(uuid, text)         from public, anon, authenticated;
revoke all on function mcp_restore_page_version(uuid)      from public, anon, authenticated;
revoke all on function mcp_create_page_version(uuid, text) from public, anon, authenticated;
grant execute on function mcp_publish_page(uuid)              to service_role;
grant execute on function mcp_rename_page(uuid, text)         to service_role;
grant execute on function mcp_restore_page_version(uuid)      to service_role;
grant execute on function mcp_create_page_version(uuid, text) to service_role;
