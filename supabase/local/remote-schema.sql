-- LOCAL REPLAY ONLY: read-only catalog snapshot of codev-os, 2026-10-05.
-- No remote data, connection string or secret. Never apply this historical fixture remotely.
do $$ begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres nologin bypassrls; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin bypassrls; end if; end $$;
alter default privileges for role postgres in schema public grant all on tables to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres,anon,authenticated,service_role;
grant usage on schema public to public,postgres,anon,authenticated,service_role;
set local role postgres;
create table public."actions" (
  "id" uuid default gen_random_uuid() not null,
  "recommendation_id" uuid,
  "agent_id" uuid not null,
  "client_id" uuid not null,
  "action_type" text not null,
  "parameters" jsonb default '{}'::jsonb not null,
  "status" text default 'draft'::text not null,
  "requires_approval" boolean default true not null,
  "approved_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "result" jsonb,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."agent_client_assignments" (
  "agent_id" uuid not null,
  "client_id" uuid not null,
  "enabled" boolean default true not null,
  "client_instructions" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."agent_messages" (
  "id" uuid default gen_random_uuid() not null,
  "recommendation_id" uuid,
  "agent_id" uuid not null,
  "client_id" uuid not null,
  "sender_type" text not null,
  "message" text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."agent_runs" (
  "id" uuid default gen_random_uuid() not null,
  "agent_id" uuid not null,
  "client_id" uuid,
  "status" text default 'running'::text not null,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "summary" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "estimated_cost_eur" numeric(12,6),
  "metadata" jsonb default '{}'::jsonb not null
);
create table public."agents" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "description" text,
  "status" text default 'inactive'::text not null,
  "instructions" text default ''::text not null,
  "model" text,
  "schedule" text,
  "autonomy_level" smallint default 0 not null,
  "enabled" boolean default false not null,
  "max_monthly_budget_eur" numeric(10,2),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."audit_logs" (
  "id" uuid default gen_random_uuid() not null,
  "actor_type" text not null,
  "actor_id" text,
  "action" text not null,
  "resource_type" text not null,
  "resource_id" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."client_connections" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "provider" text not null,
  "status" text default 'not_connected'::text not null,
  "external_account_id" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."client_events" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "event_type" text not null,
  "description" text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."client_services" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "service_type" text not null,
  "status" text default 'active'::text not null,
  "monthly_fee_eur" numeric(10,2),
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."clients" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "company_name" text,
  "activity" text,
  "email" text,
  "phone" text,
  "website" text,
  "geographic_area" text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."projects" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "name" text not null,
  "type" text not null,
  "status" text default 'À démarrer'::text not null,
  "priority" text default 'Normale'::text not null,
  "due_date" date,
  "progress" integer default 0 not null,
  "responsible" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."recommendations" (
  "id" uuid default gen_random_uuid() not null,
  "agent_id" uuid not null,
  "client_id" uuid not null,
  "title" text not null,
  "reason" text,
  "severity" text default 'info'::text not null,
  "status" text default 'pending'::text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."tasks" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "project_id" uuid,
  "title" text not null,
  "status" text default 'À faire'::text not null,
  "priority" text default 'Normale'::text not null,
  "due_date" date,
  "assignee_type" text default 'none'::text not null,
  "assignee_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table public."actions" add constraint "actions_pkey" PRIMARY KEY (id);
alter table public."agent_client_assignments" add constraint "agent_client_assignments_pkey" PRIMARY KEY (agent_id, client_id);
alter table public."agent_messages" add constraint "agent_messages_pkey" PRIMARY KEY (id);
alter table public."agent_messages" add constraint "agent_messages_sender_type_check" CHECK ((sender_type = ANY (ARRAY['admin'::text, 'agent'::text, 'system'::text])));
alter table public."agent_runs" add constraint "agent_runs_pkey" PRIMARY KEY (id);
alter table public."agents" add constraint "agents_autonomy_level_check" CHECK (((autonomy_level >= 0) AND (autonomy_level <= 3)));
alter table public."agents" add constraint "agents_name_key" UNIQUE (name);
alter table public."agents" add constraint "agents_pkey" PRIMARY KEY (id);
alter table public."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY (id);
alter table public."client_connections" add constraint "client_connections_client_id_provider_key" UNIQUE (client_id, provider);
alter table public."client_connections" add constraint "client_connections_pkey" PRIMARY KEY (id);
alter table public."client_events" add constraint "client_events_pkey" PRIMARY KEY (id);
alter table public."client_services" add constraint "client_services_client_id_service_type_key" UNIQUE (client_id, service_type);
alter table public."client_services" add constraint "client_services_pkey" PRIMARY KEY (id);
alter table public."clients" add constraint "clients_pkey" PRIMARY KEY (id);
alter table public."projects" add constraint "projects_pkey" PRIMARY KEY (id);
alter table public."projects" add constraint "projects_progress_check" CHECK (((progress >= 0) AND (progress <= 100)));
alter table public."recommendations" add constraint "recommendations_pkey" PRIMARY KEY (id);
alter table public."tasks" add constraint "tasks_assignee_type_check" CHECK ((assignee_type = ANY (ARRAY['admin'::text, 'agent'::text, 'none'::text])));
alter table public."tasks" add constraint "tasks_pkey" PRIMARY KEY (id);
alter table public."actions" add constraint "actions_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public."actions" add constraint "actions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."actions" add constraint "actions_recommendation_id_fkey" FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE SET NULL;
alter table public."agent_client_assignments" add constraint "agent_client_assignments_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public."agent_client_assignments" add constraint "agent_client_assignments_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."agent_messages" add constraint "agent_messages_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public."agent_messages" add constraint "agent_messages_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."agent_messages" add constraint "agent_messages_recommendation_id_fkey" FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE;
alter table public."agent_runs" add constraint "agent_runs_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public."agent_runs" add constraint "agent_runs_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_connections" add constraint "client_connections_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_events" add constraint "client_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_services" add constraint "client_services_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."projects" add constraint "projects_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."recommendations" add constraint "recommendations_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public."recommendations" add constraint "recommendations_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."tasks" add constraint "tasks_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."tasks" add constraint "tasks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX projects_client_id_idx ON public.projects USING btree (client_id);
CREATE INDEX projects_status_idx ON public.projects USING btree (status);
CREATE INDEX tasks_client_id_idx ON public.tasks USING btree (client_id);
CREATE INDEX tasks_project_id_idx ON public.tasks USING btree (project_id);
CREATE INDEX tasks_status_idx ON public.tasks USING btree (status);
CREATE INDEX agent_client_assignments_client_id_idx ON public.agent_client_assignments USING btree (client_id);
CREATE INDEX recommendations_client_id_idx ON public.recommendations USING btree (client_id);
CREATE INDEX recommendations_agent_id_idx ON public.recommendations USING btree (agent_id);
CREATE INDEX recommendations_status_idx ON public.recommendations USING btree (status);
CREATE INDEX client_events_client_id_idx ON public.client_events USING btree (client_id);
CREATE INDEX agent_runs_agent_id_idx ON public.agent_runs USING btree (agent_id);
CREATE INDEX agent_runs_client_id_idx ON public.agent_runs USING btree (client_id);
CREATE INDEX actions_recommendation_id_idx ON public.actions USING btree (recommendation_id);
CREATE INDEX actions_agent_id_idx ON public.actions USING btree (agent_id);
CREATE INDEX actions_client_id_idx ON public.actions USING btree (client_id);
CREATE INDEX actions_status_idx ON public.actions USING btree (status);
CREATE INDEX agent_messages_recommendation_id_idx ON public.agent_messages USING btree (recommendation_id);
CREATE INDEX agent_messages_client_id_idx ON public.agent_messages USING btree (client_id);
CREATE INDEX agent_messages_agent_id_idx ON public.agent_messages USING btree (agent_id);
CREATE INDEX client_services_client_id_idx ON public.client_services USING btree (client_id);
CREATE INDEX client_connections_client_id_idx ON public.client_connections USING btree (client_id);
CREATE INDEX audit_logs_resource_idx ON public.audit_logs USING btree (resource_type, resource_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

grant execute on function public."set_updated_at"() to public,postgres,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'audit_logs is append-only';
end;
$function$;

grant execute on function public."prevent_audit_log_mutation"() to public,postgres,anon,authenticated,service_role;
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER agents_set_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recommendations_set_updated_at BEFORE UPDATE ON public.recommendations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER actions_set_updated_at BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_connections_set_updated_at BEFORE UPDATE ON public.client_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audit_logs_no_update_delete BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
alter table public."clients" enable row level security;
grant all on public."clients" to postgres,anon,authenticated,service_role;
alter table public."projects" enable row level security;
grant all on public."projects" to postgres,anon,authenticated,service_role;
alter table public."tasks" enable row level security;
grant all on public."tasks" to postgres,anon,authenticated,service_role;
alter table public."agents" enable row level security;
grant all on public."agents" to postgres,anon,authenticated,service_role;
alter table public."agent_client_assignments" enable row level security;
grant all on public."agent_client_assignments" to postgres,anon,authenticated,service_role;
alter table public."recommendations" enable row level security;
grant all on public."recommendations" to postgres,anon,authenticated,service_role;
alter table public."client_events" enable row level security;
grant all on public."client_events" to postgres,anon,authenticated,service_role;
alter table public."agent_runs" enable row level security;
grant all on public."agent_runs" to postgres,anon,authenticated,service_role;
alter table public."actions" enable row level security;
grant all on public."actions" to postgres,anon,authenticated,service_role;
alter table public."agent_messages" enable row level security;
grant all on public."agent_messages" to postgres,anon,authenticated,service_role;
alter table public."client_services" enable row level security;
grant all on public."client_services" to postgres,anon,authenticated,service_role;
alter table public."client_connections" enable row level security;
grant all on public."client_connections" to postgres,anon,authenticated,service_role;
alter table public."audit_logs" enable row level security;
grant all on public."audit_logs" to postgres,anon,authenticated,service_role;
reset role;

