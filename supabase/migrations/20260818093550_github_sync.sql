create type "public"."github_sync_event_status" as enum ('pending', 'synced', 'dismissed');


  create table "public"."github_sync_events" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid not null,
    "commit_sha" text not null,
    "summary" text,
    "status" public.github_sync_event_status not null default 'pending'::public.github_sync_event_status,
    "detected_at" timestamp with time zone not null default now(),
    "synced_at" timestamp with time zone,
    "synced_by" uuid
      );


alter table "public"."github_sync_events" enable row level security;

alter table "public"."pages" add column "github_path" text;

alter table "public"."projects" add column "github_branch" text not null default 'main'::text;

alter table "public"."projects" add column "github_last_synced_sha" text;

alter table "public"."projects" add column "github_repo" text;

CREATE UNIQUE INDEX github_sync_events_pending_uniq ON public.github_sync_events USING btree (project_id) WHERE (status = 'pending'::public.github_sync_event_status);

CREATE UNIQUE INDEX github_sync_events_pkey ON public.github_sync_events USING btree (id);

CREATE UNIQUE INDEX github_sync_events_project_id_commit_sha_key ON public.github_sync_events USING btree (project_id, commit_sha);

CREATE INDEX github_sync_events_project_idx ON public.github_sync_events USING btree (project_id, detected_at DESC);

CREATE UNIQUE INDEX pages_github_path_idx ON public.pages USING btree (project_id, github_path) WHERE (github_path IS NOT NULL);

alter table "public"."github_sync_events" add constraint "github_sync_events_pkey" PRIMARY KEY using index "github_sync_events_pkey";

alter table "public"."github_sync_events" add constraint "github_sync_events_project_id_commit_sha_key" UNIQUE using index "github_sync_events_project_id_commit_sha_key";

alter table "public"."github_sync_events" add constraint "github_sync_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE not valid;

alter table "public"."github_sync_events" validate constraint "github_sync_events_project_id_fkey";

alter table "public"."github_sync_events" add constraint "github_sync_events_synced_by_fkey" FOREIGN KEY (synced_by) REFERENCES auth.users(id) not valid;

alter table "public"."github_sync_events" validate constraint "github_sync_events_synced_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_page_version(p_page_id uuid, p_is_published boolean DEFAULT false, p_change_summary text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_page pages%ROWTYPE;
  v_next integer;
  v_id   uuid;
BEGIN
  -- Lock the page row to serialize version numbering for this page.
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  -- Authorization: caller must own the project this page belongs to.
  IF (SELECT user_id FROM projects WHERE id = v_page.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM page_versions
   WHERE page_id = p_page_id;

  INSERT INTO page_versions (
    page_id, project_id, version_number, title, description, content,
    change_summary, is_published, published_at, created_by
  ) VALUES (
    v_page.id, v_page.project_id, v_next, v_page.title, v_page.description, v_page.content,
    p_change_summary, p_is_published,
    CASE WHEN p_is_published THEN now() ELSE NULL END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rename_page(p_page_id uuid, p_title text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_page        pages%ROWTYPE;
  v_title       text;
  v_parent_path text;
  v_base_slug   text;
  v_slug        text;
  v_new_path    text;
  v_old_path    text;
  v_suffix      integer := 1;
BEGIN
  SELECT * INTO v_page FROM pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found', p_page_id;
  END IF;

  IF (SELECT user_id FROM projects WHERE id = v_page.project_id) <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_title := COALESCE(NULLIF(trim(p_title), ''), 'Untitled');

  -- Keep published pages' slugs stable: only update the title.
  IF v_page.slug NOT LIKE 'untitled%' AND v_page.status <> 'draft' THEN
    UPDATE pages SET title = v_title, updated_by = auth.uid() WHERE id = p_page_id;
    RETURN v_page.path;
  END IF;

  -- Slugify: lowercase, non-alphanumerics → '-', collapse and trim dashes.
  v_base_slug := trim(both '-' from regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'));
  IF v_base_slug = '' THEN
    v_base_slug := 'untitled';
  END IF;

  IF v_page.parent_id IS NOT NULL THEN
    SELECT path INTO v_parent_path FROM pages WHERE id = v_page.parent_id;
  END IF;

  -- Ensure path uniqueness within the project.
  v_slug := v_base_slug;
  LOOP
    v_new_path := CASE
      WHEN v_parent_path IS NULL OR v_parent_path = '' THEN v_slug
      ELSE v_parent_path || '/' || v_slug
    END;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM pages
      WHERE project_id = v_page.project_id
        AND path = v_new_path
        AND id <> p_page_id
    );
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  v_old_path := v_page.path;

  UPDATE pages
     SET title = v_title, slug = v_slug, path = v_new_path, updated_by = auth.uid()
   WHERE id = p_page_id;

  -- Cascade the path change to all descendants (path prefix rewrite).
  IF v_old_path <> v_new_path THEN
    UPDATE pages
       SET path = v_new_path || substring(path FROM length(v_old_path) + 1)
     WHERE project_id = v_page.project_id
       AND path LIKE v_old_path || '/%';
  END IF;

  RETURN v_new_path;
END;
$function$
;

grant delete on table "public"."github_sync_events" to "anon";

grant insert on table "public"."github_sync_events" to "anon";

grant references on table "public"."github_sync_events" to "anon";

grant select on table "public"."github_sync_events" to "anon";

grant trigger on table "public"."github_sync_events" to "anon";

grant truncate on table "public"."github_sync_events" to "anon";

grant update on table "public"."github_sync_events" to "anon";

grant delete on table "public"."github_sync_events" to "authenticated";

grant insert on table "public"."github_sync_events" to "authenticated";

grant references on table "public"."github_sync_events" to "authenticated";

grant select on table "public"."github_sync_events" to "authenticated";

grant trigger on table "public"."github_sync_events" to "authenticated";

grant truncate on table "public"."github_sync_events" to "authenticated";

grant update on table "public"."github_sync_events" to "authenticated";

grant delete on table "public"."github_sync_events" to "service_role";

grant insert on table "public"."github_sync_events" to "service_role";

grant references on table "public"."github_sync_events" to "service_role";

grant select on table "public"."github_sync_events" to "service_role";

grant trigger on table "public"."github_sync_events" to "service_role";

grant truncate on table "public"."github_sync_events" to "service_role";

grant update on table "public"."github_sync_events" to "service_role";


  create policy "github_sync_events_owner_read"
  on "public"."github_sync_events"
  as permissive
  for select
  to authenticated
using ((( SELECT projects.user_id
   FROM public.projects
  WHERE (projects.id = github_sync_events.project_id)) = ( SELECT auth.uid() AS uid)));

