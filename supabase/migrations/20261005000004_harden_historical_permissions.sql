-- Clerk-guarded backend only. No historical data, FK or policy is changed.
-- Existing objects in managed auth/storage/extension schemas are untouched.
do $$
declare table_name text;
begin
 foreach table_name in array array[
  'clients','projects','tasks','agents','agent_client_assignments','agent_runs',
  'recommendations','actions','agent_messages','audit_logs','client_services',
  'client_connections','client_events','agent_project_assignments',
  'publication_settings','publication_client_settings','publication_accounts',
  'publications','publication_revisions','publication_variants','publication_assets',
  'publication_variant_assets','publication_reviews','publication_deliveries',
  'publication_jobs','publication_attempts','publication_events'
 ] loop
  execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
  execute format('revoke truncate on table public.%I from public,anon,authenticated,service_role',table_name);
 end loop;
end $$;

-- Maintain the CRUD used by existing server services; historical rows are retained.
grant select,insert,update,delete on public.clients,public.projects,public.tasks,
 public.agents,public.agent_client_assignments,public.client_services,
 public.client_connections,public.client_events to service_role;
grant select,insert,update on public.agent_runs,public.recommendations,
 public.actions,public.agent_messages to service_role;
revoke delete on public.agent_runs,public.recommendations,public.actions,
 public.agent_messages from service_role;
grant select,insert on public.audit_logs to service_role;
revoke update,delete on public.audit_logs from service_role;
-- Do not broaden the stricter Publications and project-assignment server grants.

-- Child ACLs do not prevent ON DELETE CASCADE performed by FK triggers.
-- These simple DELETE guards retain agent history without changing historical FKs.
create function agent_scope_private.prevent_history_delete() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 raise exception 'Agent history must be retained; use status transitions' using errcode='55000';
end $$;
do $$ declare table_name text; begin
 foreach table_name in array array['agent_runs','recommendations','actions','agent_messages'] loop
  execute format('create trigger %I before delete on public.%I for each row execute function agent_scope_private.prevent_history_delete()',table_name||'_retain_history',table_name);
 end loop;
end $$;
revoke all on function agent_scope_private.prevent_history_delete() from public,anon,authenticated;
grant execute on function agent_scope_private.prevent_history_delete() to service_role;

-- Keep existing function bodies, invoker mode and explicit search_path intact.
revoke all on function public.set_updated_at(),public.prevent_audit_log_mutation(),
 public.agent_set_scope(uuid,text,text),
 public.agent_project_assignment_set(uuid,uuid,boolean,text),
 public.publication_create_manual(uuid,date,smallint,text,jsonb,text),
 public.publication_revise_manual(uuid,uuid,jsonb,text),
 public.publication_review(uuid,uuid,uuid,text,text,text),
 public.publication_set_project(uuid,uuid,uuid,text),
 public.publication_create_project_manual(uuid,uuid,date,smallint,text,jsonb,text)
 from public,anon,authenticated;
grant execute on function public.set_updated_at(),public.prevent_audit_log_mutation(),
 public.agent_set_scope(uuid,text,text),
 public.agent_project_assignment_set(uuid,uuid,boolean,text),
 public.publication_create_manual(uuid,date,smallint,text,jsonb,text),
 public.publication_revise_manual(uuid,uuid,jsonb,text),
 public.publication_review(uuid,uuid,uuid,text,text,text),
 public.publication_set_project(uuid,uuid,uuid,text),
 public.publication_create_project_manual(uuid,uuid,date,smallint,text,jsonb,text)
 to service_role;
revoke all on all functions in schema agent_scope_private,publications_private from public,anon,authenticated;

-- Defaults are those of the object creator, not its inherited roles.
-- Supabase postgres cannot manage supabase_admin defaults (read-only verified).
-- Harden only creators the migration actor is actually authorized to manage.
do $$
declare creator text; can_manage boolean;
begin
 foreach creator in array array['postgres','supabase_admin'] loop
  select r.rolsuper or pg_has_role(current_user,creator,'MEMBER') into can_manage
   from pg_roles r where r.rolname=current_user;
  if not can_manage then
   raise warning 'Default privileges for managed creator % remain unchanged: migration role % is not authorized. Create CODE-V OS objects as postgres; managed-creator defaults require separate provider administration.',creator,current_user;
   continue;
  end if;
  execute format('alter default privileges for role %I in schema public revoke all on tables from public,anon,authenticated',creator);
  execute format('alter default privileges for role %I in schema public revoke truncate on tables from service_role',creator);
  execute format('alter default privileges for role %I in schema public grant select,insert,update,delete on tables to service_role',creator);
  execute format('alter default privileges for role %I in schema public revoke all on sequences from public,anon,authenticated',creator);
  execute format('alter default privileges for role %I in schema public grant usage,select,update on sequences to service_role',creator);
  execute format('alter default privileges for role %I in schema public revoke all on functions from public,anon,authenticated',creator);
  -- A schema-local REVOKE cannot remove PostgreSQL's global PUBLIC EXECUTE.
  -- This affects future functions of this creator in any schema, not existing ones.
  execute format('alter default privileges for role %I revoke execute on functions from public',creator);
  execute format('alter default privileges for role %I in schema public grant execute on functions to service_role',creator);
 end loop;
end $$;
