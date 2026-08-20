create type "public"."entity_link_kind" as enum ('text', 'media', 'both');

create type "public"."entity_link_status" as enum ('ok', 'stale', 'gap');

create type "public"."graph_extract_job_status" as enum ('pending', 'running', 'done', 'failed');


  create table "public"."content_entities" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid not null,
    "name" text not null,
    "description" text,
    "reference_image_url" text,
    "version_tag" text,
    "changed_at" timestamp with time zone,
    "change_note" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."content_entities" enable row level security;


  create table "public"."graph_extract_jobs" (
    "id" uuid not null default gen_random_uuid(),
    "page_id" uuid not null,
    "status" public.graph_extract_job_status not null default 'pending'::public.graph_extract_job_status,
    "attempts" integer not null default 0,
    "error" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."graph_extract_jobs" enable row level security;


  create table "public"."page_entity_links" (
    "id" uuid not null default gen_random_uuid(),
    "page_id" uuid not null,
    "entity_id" uuid not null,
    "kind" public.entity_link_kind not null default 'text'::public.entity_link_kind,
    "block_path" text,
    "excerpt" text,
    "status" public.entity_link_status not null default 'ok'::public.entity_link_status,
    "note" text,
    "source" text not null default 'manual'::text,
    "reviewed_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."page_entity_links" enable row level security;


  create table "public"."page_links" (
    "id" uuid not null default gen_random_uuid(),
    "from_page_id" uuid not null,
    "to_page_id" uuid not null,
    "link_text" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."page_links" enable row level security;

CREATE UNIQUE INDEX content_entities_pkey ON public.content_entities USING btree (id);

CREATE UNIQUE INDEX content_entities_project_id_name_key ON public.content_entities USING btree (project_id, name);

CREATE UNIQUE INDEX graph_extract_jobs_active_uniq ON public.graph_extract_jobs USING btree (page_id) WHERE (status = ANY (ARRAY['pending'::public.graph_extract_job_status, 'running'::public.graph_extract_job_status]));

CREATE INDEX graph_extract_jobs_pending_idx ON public.graph_extract_jobs USING btree (status, created_at) WHERE (status = 'pending'::public.graph_extract_job_status);

CREATE UNIQUE INDEX graph_extract_jobs_pkey ON public.graph_extract_jobs USING btree (id);

CREATE INDEX page_entity_links_entity_idx ON public.page_entity_links USING btree (entity_id);

CREATE UNIQUE INDEX page_entity_links_page_id_entity_id_block_path_key ON public.page_entity_links USING btree (page_id, entity_id, block_path);

CREATE INDEX page_entity_links_page_idx ON public.page_entity_links USING btree (page_id);

CREATE UNIQUE INDEX page_entity_links_pkey ON public.page_entity_links USING btree (id);

CREATE UNIQUE INDEX page_links_from_page_id_to_page_id_key ON public.page_links USING btree (from_page_id, to_page_id);

CREATE UNIQUE INDEX page_links_pkey ON public.page_links USING btree (id);

CREATE INDEX page_links_to_idx ON public.page_links USING btree (to_page_id);

alter table "public"."content_entities" add constraint "content_entities_pkey" PRIMARY KEY using index "content_entities_pkey";

alter table "public"."graph_extract_jobs" add constraint "graph_extract_jobs_pkey" PRIMARY KEY using index "graph_extract_jobs_pkey";

alter table "public"."page_entity_links" add constraint "page_entity_links_pkey" PRIMARY KEY using index "page_entity_links_pkey";

alter table "public"."page_links" add constraint "page_links_pkey" PRIMARY KEY using index "page_links_pkey";

alter table "public"."content_entities" add constraint "content_entities_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE not valid;

alter table "public"."content_entities" validate constraint "content_entities_project_id_fkey";

alter table "public"."content_entities" add constraint "content_entities_project_id_name_key" UNIQUE using index "content_entities_project_id_name_key";

alter table "public"."graph_extract_jobs" add constraint "graph_extract_jobs_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."graph_extract_jobs" validate constraint "graph_extract_jobs_page_id_fkey";

alter table "public"."page_entity_links" add constraint "page_entity_links_entity_id_fkey" FOREIGN KEY (entity_id) REFERENCES public.content_entities(id) ON DELETE CASCADE not valid;

alter table "public"."page_entity_links" validate constraint "page_entity_links_entity_id_fkey";

alter table "public"."page_entity_links" add constraint "page_entity_links_page_id_entity_id_block_path_key" UNIQUE using index "page_entity_links_page_id_entity_id_block_path_key";

alter table "public"."page_entity_links" add constraint "page_entity_links_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_entity_links" validate constraint "page_entity_links_page_id_fkey";

alter table "public"."page_links" add constraint "page_links_from_page_id_fkey" FOREIGN KEY (from_page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_links" validate constraint "page_links_from_page_id_fkey";

alter table "public"."page_links" add constraint "page_links_from_page_id_to_page_id_key" UNIQUE using index "page_links_from_page_id_to_page_id_key";

alter table "public"."page_links" add constraint "page_links_to_page_id_fkey" FOREIGN KEY (to_page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_links" validate constraint "page_links_to_page_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.enqueue_graph_extract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_published THEN
    INSERT INTO graph_extract_jobs (page_id) VALUES (NEW.page_id)
    ON CONFLICT (page_id) WHERE status IN ('pending', 'running') DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."content_entities" to "anon";

grant insert on table "public"."content_entities" to "anon";

grant references on table "public"."content_entities" to "anon";

grant select on table "public"."content_entities" to "anon";

grant trigger on table "public"."content_entities" to "anon";

grant truncate on table "public"."content_entities" to "anon";

grant update on table "public"."content_entities" to "anon";

grant delete on table "public"."content_entities" to "authenticated";

grant insert on table "public"."content_entities" to "authenticated";

grant references on table "public"."content_entities" to "authenticated";

grant select on table "public"."content_entities" to "authenticated";

grant trigger on table "public"."content_entities" to "authenticated";

grant truncate on table "public"."content_entities" to "authenticated";

grant update on table "public"."content_entities" to "authenticated";

grant delete on table "public"."content_entities" to "service_role";

grant insert on table "public"."content_entities" to "service_role";

grant references on table "public"."content_entities" to "service_role";

grant select on table "public"."content_entities" to "service_role";

grant trigger on table "public"."content_entities" to "service_role";

grant truncate on table "public"."content_entities" to "service_role";

grant update on table "public"."content_entities" to "service_role";

grant delete on table "public"."graph_extract_jobs" to "anon";

grant insert on table "public"."graph_extract_jobs" to "anon";

grant references on table "public"."graph_extract_jobs" to "anon";

grant select on table "public"."graph_extract_jobs" to "anon";

grant trigger on table "public"."graph_extract_jobs" to "anon";

grant truncate on table "public"."graph_extract_jobs" to "anon";

grant update on table "public"."graph_extract_jobs" to "anon";

grant delete on table "public"."graph_extract_jobs" to "authenticated";

grant insert on table "public"."graph_extract_jobs" to "authenticated";

grant references on table "public"."graph_extract_jobs" to "authenticated";

grant select on table "public"."graph_extract_jobs" to "authenticated";

grant trigger on table "public"."graph_extract_jobs" to "authenticated";

grant truncate on table "public"."graph_extract_jobs" to "authenticated";

grant update on table "public"."graph_extract_jobs" to "authenticated";

grant delete on table "public"."graph_extract_jobs" to "service_role";

grant insert on table "public"."graph_extract_jobs" to "service_role";

grant references on table "public"."graph_extract_jobs" to "service_role";

grant select on table "public"."graph_extract_jobs" to "service_role";

grant trigger on table "public"."graph_extract_jobs" to "service_role";

grant truncate on table "public"."graph_extract_jobs" to "service_role";

grant update on table "public"."graph_extract_jobs" to "service_role";

grant delete on table "public"."page_entity_links" to "anon";

grant insert on table "public"."page_entity_links" to "anon";

grant references on table "public"."page_entity_links" to "anon";

grant select on table "public"."page_entity_links" to "anon";

grant trigger on table "public"."page_entity_links" to "anon";

grant truncate on table "public"."page_entity_links" to "anon";

grant update on table "public"."page_entity_links" to "anon";

grant delete on table "public"."page_entity_links" to "authenticated";

grant insert on table "public"."page_entity_links" to "authenticated";

grant references on table "public"."page_entity_links" to "authenticated";

grant select on table "public"."page_entity_links" to "authenticated";

grant trigger on table "public"."page_entity_links" to "authenticated";

grant truncate on table "public"."page_entity_links" to "authenticated";

grant update on table "public"."page_entity_links" to "authenticated";

grant delete on table "public"."page_entity_links" to "service_role";

grant insert on table "public"."page_entity_links" to "service_role";

grant references on table "public"."page_entity_links" to "service_role";

grant select on table "public"."page_entity_links" to "service_role";

grant trigger on table "public"."page_entity_links" to "service_role";

grant truncate on table "public"."page_entity_links" to "service_role";

grant update on table "public"."page_entity_links" to "service_role";

grant delete on table "public"."page_links" to "anon";

grant insert on table "public"."page_links" to "anon";

grant references on table "public"."page_links" to "anon";

grant select on table "public"."page_links" to "anon";

grant trigger on table "public"."page_links" to "anon";

grant truncate on table "public"."page_links" to "anon";

grant update on table "public"."page_links" to "anon";

grant delete on table "public"."page_links" to "authenticated";

grant insert on table "public"."page_links" to "authenticated";

grant references on table "public"."page_links" to "authenticated";

grant select on table "public"."page_links" to "authenticated";

grant trigger on table "public"."page_links" to "authenticated";

grant truncate on table "public"."page_links" to "authenticated";

grant update on table "public"."page_links" to "authenticated";

grant delete on table "public"."page_links" to "service_role";

grant insert on table "public"."page_links" to "service_role";

grant references on table "public"."page_links" to "service_role";

grant select on table "public"."page_links" to "service_role";

grant trigger on table "public"."page_links" to "service_role";

grant truncate on table "public"."page_links" to "service_role";

grant update on table "public"."page_links" to "service_role";


  create policy "content_entities_owner_all"
  on "public"."content_entities"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = content_entities.project_id) AND (projects.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = content_entities.project_id) AND (projects.user_id = auth.uid())))));



  create policy "graph_extract_jobs_owner_read"
  on "public"."graph_extract_jobs"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = graph_extract_jobs.page_id) AND (projects.user_id = auth.uid())))));



  create policy "page_entity_links_owner_all"
  on "public"."page_entity_links"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = page_entity_links.page_id) AND (projects.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = page_entity_links.page_id) AND (projects.user_id = auth.uid())))));



  create policy "page_links_owner_all"
  on "public"."page_links"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = page_links.from_page_id) AND (projects.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = page_links.from_page_id) AND (projects.user_id = auth.uid())))));


CREATE TRIGGER content_entities_updated_at BEFORE UPDATE ON public.content_entities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER graph_extract_jobs_updated_at BEFORE UPDATE ON public.graph_extract_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER page_entity_links_updated_at BEFORE UPDATE ON public.page_entity_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER page_versions_enqueue_graph_extract AFTER INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION public.enqueue_graph_extract();

