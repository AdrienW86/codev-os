-- Requires the existing CODE-V OS tables described by database.types.ts.
-- No historical project is guessed from an agent name or metadata.
create schema agent_scope_private;
revoke all on schema agent_scope_private from public, anon, authenticated;
grant usage on schema agent_scope_private to service_role;

alter table public.agents add column agent_scope text not null default 'client'
  check (agent_scope in ('client','project'));
alter table public.agents add column scope_review_required boolean not null default true;
-- Existing agents remain flagged. New callers must choose their scope explicitly.
alter table public.projects add constraint projects_scope_identity unique (id,client_id);
alter table public.agent_client_assignments add constraint agent_client_scope_identity unique (agent_id,client_id);

create table public.agent_project_assignments (
  agent_id uuid not null references public.agents(id) on delete restrict, client_id uuid not null, project_id uuid not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (agent_id,project_id),
  foreign key (agent_id,client_id) references public.agent_client_assignments(agent_id,client_id) on delete restrict,
  foreign key (project_id,client_id) references public.projects(id,client_id) on delete restrict
);
alter table public.agent_project_assignments enable row level security;
revoke all on public.agent_project_assignments from public,anon,authenticated,service_role;
grant select,insert,update on public.agent_project_assignments to service_role;
create index agent_project_assignments_project_idx on public.agent_project_assignments(project_id,client_id);
create index agent_project_assignments_client_idx on public.agent_project_assignments(client_id,agent_id);

do $$ declare table_name text;
begin
  foreach table_name in array array['agent_runs','recommendations','actions','agent_messages'] loop
    execute format('alter table public.%I add column project_id uuid',table_name);
    execute format('alter table public.%I add constraint %I foreign key (project_id,client_id) references public.projects(id,client_id) on delete restrict not valid',table_name,table_name || '_project_client_fk');
    execute format('create index %I on public.%I(project_id,client_id)',table_name || '_project_scope_idx',table_name);
  end loop;
end $$;
alter table public.tasks add constraint tasks_project_client_scope_fk
  foreign key (project_id,client_id) references public.projects(id,client_id) on delete restrict not valid;
alter table public.tasks add column completed_at timestamptz;
-- Old completed tasks are intentionally undated until reviewed manually.
create function agent_scope_private.task_completion() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.status='Terminé' and (tg_op='INSERT' or old.status is distinct from new.status) then
    new.completed_at := clock_timestamp();
  elsif new.status<>'Terminé' then new.completed_at:=null;
  elsif tg_op='UPDATE' then new.completed_at:=old.completed_at;
  end if;
  return new;
end $$;
create trigger tasks_completion before insert or update on public.tasks
  for each row execute function agent_scope_private.task_completion();
create index tasks_completed_scope_idx on public.tasks(client_id,completed_at) where completed_at is not null;

create function agent_scope_private.context_allowed(p_agent uuid,p_client uuid,p_project uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from public.agents a join public.agent_client_assignments ca on ca.agent_id=a.id
    where a.id=p_agent and ca.client_id=p_client and ca.enabled and a.enabled and a.status='Actif'
      and ((a.agent_scope='client' and p_project is null)
        or (a.agent_scope='project' and not a.scope_review_required and p_project is not null and exists(
          select 1 from public.agent_project_assignments pa join public.projects p on p.id=pa.project_id and p.client_id=pa.client_id
          where pa.agent_id=p_agent and pa.client_id=p_client and pa.project_id=p_project and pa.enabled))));
$$;

create function agent_scope_private.check_assignment() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  perform 1 from public.agents where id=new.agent_id for update;
  if new.enabled and not exists(select 1 from public.agents a join public.agent_client_assignments ca on ca.agent_id=a.id
    where a.id=new.agent_id and a.agent_scope='project' and not a.scope_review_required and ca.client_id=new.client_id and ca.enabled) then
    raise exception 'Project assignment requires confirmed project scope and enabled client assignment' using errcode='23514';
  end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger agent_project_scope_check before insert or update on public.agent_project_assignments
  for each row execute function agent_scope_private.check_assignment();

create function agent_scope_private.lock_client_assignment() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then perform 1 from public.agents where id=old.agent_id for update; return old; end if;
 perform 1 from public.agents where id=new.agent_id for update; return new;
end $$;
create trigger agent_client_scope_lock before insert or update or delete on public.agent_client_assignments
 for each row execute function agent_scope_private.lock_client_assignment();

create function agent_scope_private.check_context() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare recommendation public.recommendations;
begin
  if tg_op='UPDATE' then
    if (new.agent_id,new.client_id,new.project_id) is distinct from (old.agent_id,old.client_id,old.project_id) then
      raise exception 'Historical context is immutable' using errcode='55000';
    end if;
  end if;
  perform 1 from public.agents where id=new.agent_id for share;
  if tg_table_name in ('actions','agent_messages') then
   if tg_op='UPDATE' and new.recommendation_id is distinct from old.recommendation_id then
     raise exception 'Recommendation identity is immutable' using errcode='55000';
   end if;
   if new.recommendation_id is not null then
    select * into recommendation from public.recommendations where id=new.recommendation_id;
    if not found or (new.agent_id,new.client_id,new.project_id) is distinct from
      (recommendation.agent_id,recommendation.client_id,recommendation.project_id) then
      raise exception 'Recommendation context mismatch' using errcode='23514';
    end if;
   end if;
  end if;
  if tg_op='UPDATE' then
    if tg_table_name='actions' then
      if new.status is distinct from old.status and new.status in ('approved','executing') and not agent_scope_private.context_allowed(new.agent_id,new.client_id,new.project_id) then
        raise exception 'Action scope no longer authorized' using errcode='23514';
      end if;
    end if;
    return new;
  end if;
  if not agent_scope_private.context_allowed(new.agent_id,new.client_id,new.project_id) then
    raise exception 'Agent scope or assignment does not authorize this context' using errcode='23514';
  end if;
  return new;
end $$;
do $$ declare table_name text;
begin
  foreach table_name in array array['agent_runs','recommendations','actions','agent_messages'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function agent_scope_private.check_context()',table_name || '_scope_check',table_name);
  end loop;
end $$;

-- Scope/context identities cannot be silently changed after dependent history.
create function agent_scope_private.protect_scope_change() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (new.agent_scope,new.scope_review_required) is distinct from (old.agent_scope,old.scope_review_required) then
    if nullif(current_setting('codev.admin_actor',true),'') is null then
      raise exception 'Use the audited scope RPC' using errcode='42501';
    end if;
    if new.agent_scope<>old.agent_scope and (exists(select 1 from public.agent_runs where agent_id=old.id and status='running')
      or exists(select 1 from public.actions where agent_id=old.id and status='executing')
      or exists(select 1 from public.agent_project_assignments where agent_id=old.id and enabled)) then
      raise exception 'Resolve running work and disable project assignments before changing scope' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
create trigger agents_scope_change before update of agent_scope,scope_review_required on public.agents
  for each row execute function agent_scope_private.protect_scope_change();

create function public.agent_set_scope(p_agent_id uuid,p_scope text,p_actor_id text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare before_agent public.agents;
begin
  if p_scope not in ('client','project') or p_scope is null or p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then
    raise exception 'Invalid scope input' using errcode='22023';
  end if;
  select * into before_agent from public.agents where id=p_agent_id for update;
  if not found then raise exception 'Unknown agent' using errcode='22023'; end if;
  perform set_config('codev.admin_actor',p_actor_id,true);
  update public.agents set agent_scope=p_scope,scope_review_required=false where id=p_agent_id;
  insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,before_data,after_data,metadata)
    values('agent.scope_changed','admin',p_actor_id,'agent',p_agent_id,
      jsonb_build_object('agent_scope',before_agent.agent_scope,'scope_review_required',before_agent.scope_review_required),
      jsonb_build_object('agent_scope',p_scope,'scope_review_required',false),'{}');
  perform set_config('codev.admin_actor','',true);
end $$;

create function public.agent_project_assignment_set(p_agent_id uuid,p_project_id uuid,p_enabled boolean,p_actor_id text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare project public.projects; previous_enabled boolean;
begin
  if p_enabled is null or p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid assignment input' using errcode='22023'; end if;
  perform 1 from public.agents where id=p_agent_id for update;
  select * into project from public.projects where id=p_project_id;
  if not found then raise exception 'Unknown project' using errcode='22023'; end if;
  select enabled into previous_enabled from public.agent_project_assignments where agent_id=p_agent_id and project_id=p_project_id for update;
  insert into public.agent_project_assignments(agent_id,client_id,project_id,enabled) values(p_agent_id,project.client_id,p_project_id,p_enabled)
    on conflict(agent_id,project_id) do update set enabled=excluded.enabled;
  insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,before_data,after_data,metadata)
    values(case when p_enabled then 'agent.project_assigned' else 'agent.project_removed' end,'admin',p_actor_id,'project',p_project_id,
      jsonb_build_object('enabled',previous_enabled),jsonb_build_object('enabled',p_enabled),
      jsonb_build_object('agent_id',p_agent_id,'client_id',project.client_id,'project_id',p_project_id));
end $$;

-- New writes are protected; existing policies are neither broadened nor replaced.
alter table public.agents enable row level security;
alter table public.agent_client_assignments enable row level security;
alter table public.agent_runs enable row level security;
alter table public.recommendations enable row level security;
alter table public.actions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.audit_logs enable row level security;
-- These domains are accessed exclusively by the Clerk-guarded server.
-- Existing policies cannot reopen access without table privileges.
revoke all on public.agents,public.agent_client_assignments,public.agent_runs,public.recommendations,public.actions,public.agent_messages,public.tasks,public.projects,public.audit_logs from public,anon,authenticated;
revoke all on all functions in schema agent_scope_private from public,anon,authenticated;
grant execute on all functions in schema agent_scope_private to service_role;
revoke all on function public.agent_set_scope(uuid,text,text) from public,anon,authenticated;
revoke all on function public.agent_project_assignment_set(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.agent_set_scope(uuid,text,text) to service_role;
grant execute on function public.agent_project_assignment_set(uuid,uuid,boolean,text) to service_role;
