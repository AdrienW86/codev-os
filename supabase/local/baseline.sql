-- LOCAL VALIDATION ONLY. Reconstructed from the repository's pre-scope TS contract.
-- No remote schema/data read. Unknown production defaults/policies are not certified.
-- Apply before the four feature migrations, never push as a production baseline.
create table public.clients (
 id uuid primary key default gen_random_uuid(),name text not null,company_name text,activity text,email text,phone text,website text,geographic_area text,notes text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.projects (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,
 name text not null,type text,status text not null default 'À démarrer',priority text not null default 'Moyenne',due_date date,progress integer not null default 0,responsible text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.agents (
 id uuid primary key default gen_random_uuid(),name text not null,description text,status text not null default 'Inactif',instructions text not null default '',model text,schedule text,
 autonomy_level integer not null default 0,enabled boolean not null default false,max_monthly_budget_eur numeric,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.agent_client_assignments (
 agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid not null references public.clients(id) on delete restrict,
 enabled boolean not null default false,client_instructions text,created_at timestamptz not null default now(),primary key(agent_id,client_id)
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,project_id uuid references public.projects(id) on delete restrict,
 title text not null default 'Local fixture task',status text not null default 'À faire',priority text not null default 'Moyenne',due_date date,
 assignee_type text not null default 'none',assignee_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(),action text not null,actor_type text not null,actor_id text,resource_type text not null,resource_id uuid,
 before_data jsonb,after_data jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.recommendations (
 id uuid primary key default gen_random_uuid(),agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid not null references public.clients(id) on delete restrict,
 title text not null default 'Local fixture recommendation',reason text,severity text not null default 'info',status text not null default 'pending',payload jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.agent_runs (
 id uuid primary key default gen_random_uuid(),agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid references public.clients(id) on delete restrict,
 status text not null default 'running',started_at timestamptz not null default now(),completed_at timestamptz,summary text,input_tokens integer,output_tokens integer,estimated_cost_eur numeric,metadata jsonb not null default '{}'
);
create table public.agent_messages (
 id uuid primary key default gen_random_uuid(),recommendation_id uuid references public.recommendations(id) on delete restrict,
 agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid not null references public.clients(id) on delete restrict,
 sender_type text not null default 'admin',message text not null default 'Local fixture message',metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.actions (
 id uuid primary key default gen_random_uuid(),recommendation_id uuid references public.recommendations(id) on delete restrict,
 agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid not null references public.clients(id) on delete restrict,
 action_type text not null default 'internal.test',parameters jsonb not null default '{}',status text not null default 'pending_approval',requires_approval boolean not null default true,
 approved_at timestamptz,executed_at timestamptz,result jsonb,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.client_connections (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,provider text not null,status text not null default 'disconnected',
 external_account_id text,metadata jsonb not null default '{}',last_checked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.client_services (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,service_type text not null,status text not null,
 monthly_fee_eur numeric,notes text,created_at timestamptz not null default now()
);
do $$ declare name text;
begin
 foreach name in array array['clients','projects','agents','agent_client_assignments','tasks','audit_logs','recommendations','agent_runs','agent_messages','actions','client_connections','client_services'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select,insert,update,delete on public.%I to service_role',name);
 end loop;
end $$;
revoke update,delete on public.audit_logs from service_role;
