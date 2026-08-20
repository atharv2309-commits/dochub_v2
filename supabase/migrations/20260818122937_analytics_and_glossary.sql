create type "public"."page_event_type" as enum ('search_query', 'search_zero_result', 'pdf_download', 'copy_page', 'view_markdown', 'open_chatgpt', 'open_claude', 'mcp_connect_click', 'feedback');


  create table "public"."analytics_insights" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid not null,
    "period_start" timestamp with time zone not null,
    "period_end" timestamp with time zone not null,
    "summary" jsonb not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."analytics_insights" enable row level security;


  create table "public"."page_events" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid not null,
    "page_id" uuid,
    "event_type" public.page_event_type not null,
    "locale" text,
    "query_text" text,
    "helpful" boolean,
    "comment" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."page_events" enable row level security;


  create table "public"."translation_glossary" (
    "id" uuid not null default gen_random_uuid(),
    "term" text not null,
    "notes" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."translation_glossary" enable row level security;

CREATE UNIQUE INDEX analytics_insights_pkey ON public.analytics_insights USING btree (id);

CREATE INDEX analytics_insights_project_idx ON public.analytics_insights USING btree (project_id, created_at DESC);

CREATE UNIQUE INDEX page_events_pkey ON public.page_events USING btree (id);

CREATE INDEX page_events_project_created_idx ON public.page_events USING btree (project_id, created_at DESC);

CREATE INDEX page_events_type_idx ON public.page_events USING btree (project_id, event_type, created_at DESC);

CREATE UNIQUE INDEX translation_glossary_pkey ON public.translation_glossary USING btree (id);

CREATE UNIQUE INDEX translation_glossary_term_key ON public.translation_glossary USING btree (term);

alter table "public"."analytics_insights" add constraint "analytics_insights_pkey" PRIMARY KEY using index "analytics_insights_pkey";

alter table "public"."page_events" add constraint "page_events_pkey" PRIMARY KEY using index "page_events_pkey";

alter table "public"."translation_glossary" add constraint "translation_glossary_pkey" PRIMARY KEY using index "translation_glossary_pkey";

alter table "public"."analytics_insights" add constraint "analytics_insights_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE not valid;

alter table "public"."analytics_insights" validate constraint "analytics_insights_project_id_fkey";

alter table "public"."page_events" add constraint "page_events_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE SET NULL not valid;

alter table "public"."page_events" validate constraint "page_events_page_id_fkey";

alter table "public"."page_events" add constraint "page_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE not valid;

alter table "public"."page_events" validate constraint "page_events_project_id_fkey";

alter table "public"."translation_glossary" add constraint "translation_glossary_term_key" UNIQUE using index "translation_glossary_term_key";

grant delete on table "public"."analytics_insights" to "anon";

grant insert on table "public"."analytics_insights" to "anon";

grant references on table "public"."analytics_insights" to "anon";

grant select on table "public"."analytics_insights" to "anon";

grant trigger on table "public"."analytics_insights" to "anon";

grant truncate on table "public"."analytics_insights" to "anon";

grant update on table "public"."analytics_insights" to "anon";

grant delete on table "public"."analytics_insights" to "authenticated";

grant insert on table "public"."analytics_insights" to "authenticated";

grant references on table "public"."analytics_insights" to "authenticated";

grant select on table "public"."analytics_insights" to "authenticated";

grant trigger on table "public"."analytics_insights" to "authenticated";

grant truncate on table "public"."analytics_insights" to "authenticated";

grant update on table "public"."analytics_insights" to "authenticated";

grant delete on table "public"."analytics_insights" to "service_role";

grant insert on table "public"."analytics_insights" to "service_role";

grant references on table "public"."analytics_insights" to "service_role";

grant select on table "public"."analytics_insights" to "service_role";

grant trigger on table "public"."analytics_insights" to "service_role";

grant truncate on table "public"."analytics_insights" to "service_role";

grant update on table "public"."analytics_insights" to "service_role";

grant delete on table "public"."page_events" to "anon";

grant insert on table "public"."page_events" to "anon";

grant references on table "public"."page_events" to "anon";

grant select on table "public"."page_events" to "anon";

grant trigger on table "public"."page_events" to "anon";

grant truncate on table "public"."page_events" to "anon";

grant update on table "public"."page_events" to "anon";

grant delete on table "public"."page_events" to "authenticated";

grant insert on table "public"."page_events" to "authenticated";

grant references on table "public"."page_events" to "authenticated";

grant select on table "public"."page_events" to "authenticated";

grant trigger on table "public"."page_events" to "authenticated";

grant truncate on table "public"."page_events" to "authenticated";

grant update on table "public"."page_events" to "authenticated";

grant delete on table "public"."page_events" to "service_role";

grant insert on table "public"."page_events" to "service_role";

grant references on table "public"."page_events" to "service_role";

grant select on table "public"."page_events" to "service_role";

grant trigger on table "public"."page_events" to "service_role";

grant truncate on table "public"."page_events" to "service_role";

grant update on table "public"."page_events" to "service_role";

grant delete on table "public"."translation_glossary" to "anon";

grant insert on table "public"."translation_glossary" to "anon";

grant references on table "public"."translation_glossary" to "anon";

grant select on table "public"."translation_glossary" to "anon";

grant trigger on table "public"."translation_glossary" to "anon";

grant truncate on table "public"."translation_glossary" to "anon";

grant update on table "public"."translation_glossary" to "anon";

grant delete on table "public"."translation_glossary" to "authenticated";

grant insert on table "public"."translation_glossary" to "authenticated";

grant references on table "public"."translation_glossary" to "authenticated";

grant select on table "public"."translation_glossary" to "authenticated";

grant trigger on table "public"."translation_glossary" to "authenticated";

grant truncate on table "public"."translation_glossary" to "authenticated";

grant update on table "public"."translation_glossary" to "authenticated";

grant delete on table "public"."translation_glossary" to "service_role";

grant insert on table "public"."translation_glossary" to "service_role";

grant references on table "public"."translation_glossary" to "service_role";

grant select on table "public"."translation_glossary" to "service_role";

grant trigger on table "public"."translation_glossary" to "service_role";

grant truncate on table "public"."translation_glossary" to "service_role";

grant update on table "public"."translation_glossary" to "service_role";


  create policy "analytics_insights_owner_read"
  on "public"."analytics_insights"
  as permissive
  for select
  to authenticated
using ((( SELECT projects.user_id
   FROM public.projects
  WHERE (projects.id = analytics_insights.project_id)) = ( SELECT auth.uid() AS uid)));



  create policy "page_events_owner_read"
  on "public"."page_events"
  as permissive
  for select
  to authenticated
using ((( SELECT projects.user_id
   FROM public.projects
  WHERE (projects.id = page_events.project_id)) = ( SELECT auth.uid() AS uid)));



  create policy "page_events_public_insert"
  on "public"."page_events"
  as permissive
  for insert
  to anon, authenticated
with check ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = page_events.project_id) AND (projects.visibility = 'public'::text)))));



  create policy "translation_glossary_authenticated_all"
  on "public"."translation_glossary"
  as permissive
  for all
  to authenticated
using (true)
with check (true);


CREATE TRIGGER translation_glossary_updated_at BEFORE UPDATE ON public.translation_glossary FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


