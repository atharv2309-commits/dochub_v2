-- AI search: Postgres full-text search over published pages.
--
-- Replaces the in-app keyword scoring (which loaded every page into the server
-- on each query) with an indexed FTS lookup that returns only the top matches.
-- The tsvector is a GENERATED column, so Postgres maintains it synchronously on
-- every write — no embedding index, no cron job, no drift. New/edited pages are
-- searchable the instant publish_page() flips status to 'published'.

-- 1. Flatten BlockNote JSON content to plain text.
--    Mirrors lib/utils/extract-text.ts: walk blocks' inline content + children.
--    IMMUTABLE so it can back a generated column.
create or replace function blocknote_text(content jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  parts text := '';
  block jsonb;
  node  jsonb;
begin
  if content is null or jsonb_typeof(content) <> 'array' then
    return '';
  end if;
  for block in select * from jsonb_array_elements(content) loop
    if jsonb_typeof(block->'content') = 'array' then
      for node in select * from jsonb_array_elements(block->'content') loop
        if node->>'text' is not null then
          parts := parts || ' ' || (node->>'text');
        end if;
      end loop;
    end if;
    if jsonb_typeof(block->'children') = 'array' then
      parts := parts || ' ' || blocknote_text(block->'children');
    end if;
  end loop;
  return parts;
end;
$$;

-- 2. Generated tsvector column + GIN index.
--    Title (A) > description (B) > body (C) so titles rank highest.
alter table pages
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', blocknote_text(content)), 'C')
  ) stored;

create index if not exists pages_search_vector_idx on pages using gin (search_vector);

-- 3. Retrieval RPC. websearch_to_tsquery tolerates arbitrary user input (quotes,
--    OR, etc.) and never throws. Returns content so the app reuses extractText
--    for the per-page context it stuffs into the model.
create or replace function search_pages(
  p_project_slug text,
  p_query        text,
  p_limit        int default 6
)
returns table (
  title       text,
  path        text,
  description text,
  content     jsonb
)
language sql
stable
set search_path = public
as $$
  select p.title, p.path, p.description, p.content
  from pages p
  join projects pr on pr.id = p.project_id
  where pr.slug = p_project_slug
    and pr.visibility = 'public'
    and p.status = 'published'
    and p.hidden = false
    and p.kind = 'document'
    and p.search_vector @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(p.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function search_pages(text, text, int) to anon, authenticated;
