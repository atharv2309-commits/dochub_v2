create type "public"."entity_audit_job_status" as enum ('pending', 'running', 'done', 'failed');


  create table "public"."entity_audit_jobs" (
    "id" uuid not null default gen_random_uuid(),
    "entity_id" uuid not null,
    "page_id" uuid not null,
    "status" public.entity_audit_job_status not null default 'pending'::public.entity_audit_job_status,
    "attempts" integer not null default 0,
    "error" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."entity_audit_jobs" enable row level security;

CREATE UNIQUE INDEX entity_audit_jobs_active_uniq ON public.entity_audit_jobs USING btree (entity_id, page_id) WHERE (status = ANY (ARRAY['pending'::public.entity_audit_job_status, 'running'::public.entity_audit_job_status]));

CREATE INDEX entity_audit_jobs_pending_idx ON public.entity_audit_jobs USING btree (status, created_at) WHERE (status = 'pending'::public.entity_audit_job_status);

CREATE UNIQUE INDEX entity_audit_jobs_pkey ON public.entity_audit_jobs USING btree (id);

alter table "public"."entity_audit_jobs" add constraint "entity_audit_jobs_pkey" PRIMARY KEY using index "entity_audit_jobs_pkey";

alter table "public"."entity_audit_jobs" add constraint "entity_audit_jobs_entity_id_fkey" FOREIGN KEY (entity_id) REFERENCES public.content_entities(id) ON DELETE CASCADE not valid;

alter table "public"."entity_audit_jobs" validate constraint "entity_audit_jobs_entity_id_fkey";

alter table "public"."entity_audit_jobs" add constraint "entity_audit_jobs_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."entity_audit_jobs" validate constraint "entity_audit_jobs_page_id_fkey";

grant delete on table "public"."entity_audit_jobs" to "anon";

grant insert on table "public"."entity_audit_jobs" to "anon";

grant references on table "public"."entity_audit_jobs" to "anon";

grant select on table "public"."entity_audit_jobs" to "anon";

grant trigger on table "public"."entity_audit_jobs" to "anon";

grant truncate on table "public"."entity_audit_jobs" to "anon";

grant update on table "public"."entity_audit_jobs" to "anon";

grant delete on table "public"."entity_audit_jobs" to "authenticated";

grant insert on table "public"."entity_audit_jobs" to "authenticated";

grant references on table "public"."entity_audit_jobs" to "authenticated";

grant select on table "public"."entity_audit_jobs" to "authenticated";

grant trigger on table "public"."entity_audit_jobs" to "authenticated";

grant truncate on table "public"."entity_audit_jobs" to "authenticated";

grant update on table "public"."entity_audit_jobs" to "authenticated";

grant delete on table "public"."entity_audit_jobs" to "service_role";

grant insert on table "public"."entity_audit_jobs" to "service_role";

grant references on table "public"."entity_audit_jobs" to "service_role";

grant select on table "public"."entity_audit_jobs" to "service_role";

grant trigger on table "public"."entity_audit_jobs" to "service_role";

grant truncate on table "public"."entity_audit_jobs" to "service_role";

grant update on table "public"."entity_audit_jobs" to "service_role";


  create policy "entity_audit_jobs_owner_insert"
  on "public"."entity_audit_jobs"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = entity_audit_jobs.page_id) AND (projects.user_id = auth.uid())))));



  create policy "entity_audit_jobs_owner_select"
  on "public"."entity_audit_jobs"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.pages
     JOIN public.projects ON ((projects.id = pages.project_id)))
  WHERE ((pages.id = entity_audit_jobs.page_id) AND (projects.user_id = auth.uid())))));


CREATE TRIGGER entity_audit_jobs_updated_at BEFORE UPDATE ON public.entity_audit_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

