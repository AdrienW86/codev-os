-- CODE-V OS V1 — noyau fonctionnel.
-- Services ↔ agents, registre d'agents, actions gelées à l'approbation, automatisations,
-- jobs idempotents, rapports versionnés, agenda, incidents, contrôles de sites,
-- métriques fournisseurs, veille, connexions globales.
--
-- Append-only : aucune table existante recréée, aucune colonne supprimée, aucune donnée effacée.
-- Accès serveur uniquement (service_role). Aucun privilège pour anon/authenticated.

create schema if not exists codev_private;
revoke all on schema codev_private from public;
grant usage on schema codev_private to service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Services souscrits : clé de catalogue + cycle de vie (table existante, 0 ligne en production).
-- ---------------------------------------------------------------------------------------------
alter table public.client_services
  add column if not exists service_key text,
  add column if not exists lifecycle text not null default 'active',
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.client_services
  add constraint client_services_lifecycle_check check (lifecycle in ('active','to_configure','paused','ended')),
  add constraint client_services_service_key_check check (service_key is null or service_key ~ '^[a-z][a-z0-9-]{1,40}$');
create unique index client_services_client_service_key_unique on public.client_services(client_id, service_key) where service_key is not null;
create trigger client_services_set_updated_at before update on public.client_services for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. Registre d'agents : type stable (lien avec le registre applicatif) + affectations sourcées.
-- ---------------------------------------------------------------------------------------------
alter table public.agents add column if not exists agent_type text;
alter table public.agents add constraint agents_agent_type_check check (agent_type is null or agent_type ~ '^[a-z][a-z0-9-]{1,40}$');
create index agents_agent_type_idx on public.agents(agent_type);

-- Rattache les agents existants à leur type, sans rien renommer.
update public.agents set agent_type = 'publications' where agent_type is null and publication_specialist;
update public.agents set agent_type = 'google-ads' where agent_type is null and lower(name) ~ '(google ads|\mads\M|\msea\M)';
update public.agents set agent_type = 'seo' where agent_type is null and lower(name) ~ '(\mseo\M|r[ée]f[ée]rencement)';
update public.agents set agent_type = 'monitoring' where agent_type is null and lower(name) ~ '(monitoring|maintenance)';
update public.agents set agent_type = 'report' where agent_type is null and lower(name) ~ '(rapport|report|account manager)';

-- Agents du registre manquants. Seul l'Agent Rapport (effets internes uniquement) est actif ;
-- les autres restent en pause jusqu'à leur configuration. Autonomie 0 ou 1 uniquement.
insert into public.agents(name, description, status, instructions, autonomy_level, enabled, agent_scope, scope_review_required, agent_type)
select v.name, v.description, v.status, '', v.autonomy, v.enabled, v.scope, false, v.agent_type
from (values
  ('Agent Rapport', 'Account manager : synthèses hebdomadaires et mensuelles de chaque client.', 'Actif', 0::smallint, true, 'client', 'report'),
  ('Agent SEO & Site', 'Analyse Search Console, performances et opportunités ; propose des améliorations.', 'En pause', 1::smallint, false, 'client', 'seo'),
  ('Agent Google Ads', 'Surveillance des campagnes en lecture seule ; propose des optimisations.', 'En pause', 1::smallint, false, 'client', 'google-ads'),
  ('Agent Monitoring Technique', 'Disponibilité, performances, déploiements et régressions des sites.', 'En pause', 1::smallint, false, 'client', 'monitoring'),
  ('Agent Automatisation', 'Workflows et intégrations sur mesure.', 'En pause', 1::smallint, false, 'client', 'automation'),
  ('Agent Veille', 'Veille tech, IA, SEO et Ads à partir de flux publics.', 'Actif', 0::smallint, true, 'client', 'veille')
) as v(name, description, status, autonomy, enabled, scope, agent_type)
where not exists (select 1 from public.agents a where a.agent_type = v.agent_type)
  and not exists (select 1 from public.agents a where a.name = v.name);

alter table public.agent_client_assignments
  add column if not exists source text not null default 'manual',
  add column if not exists service_key text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.agent_client_assignments
  add constraint agent_client_assignments_source_check check (source in ('manual','service','global'));
create trigger agent_client_assignments_set_updated_at before update on public.agent_client_assignments for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 3. Actions : charge utile gelée à l'approbation.
-- ---------------------------------------------------------------------------------------------
alter table public.actions
  add column if not exists payload_hash text,
  add column if not exists approved_payload_hash text,
  add column if not exists approved_by text,
  add column if not exists prepared_by text,
  add column if not exists execution_mode text not null default 'internal',
  add column if not exists incident_id uuid;
alter table public.actions
  add constraint actions_execution_mode_check check (execution_mode in ('internal','manual','external')),
  add constraint actions_status_v1_check check (status in ('draft','pending_approval','approved','executing','executed','failed','cancelled','rejected','uncertain')) not valid;

create function codev_private.payload_hash(value jsonb) returns text
language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(coalesce(value, '{}'::jsonb)::text, 'UTF8')), 'hex')
$$;

create function codev_private.actions_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  new.payload_hash := codev_private.payload_hash(new.parameters);
  if tg_op = 'UPDATE' then
    if new.parameters is distinct from old.parameters and old.status in ('approved','executing','executed','failed','uncertain') then
      raise exception 'Approved action payload is frozen' using errcode = '55000';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_payload_hash := new.payload_hash;
      new.approved_at := coalesce(new.approved_at, now());
    end if;
    if new.status = 'executing' and old.status is distinct from 'executing'
       and (old.status <> 'approved' or new.approved_payload_hash is distinct from new.payload_hash) then
      raise exception 'Only an approved, unchanged action can execute' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
create trigger actions_guard before insert or update on public.actions for each row execute function codev_private.actions_guard();

-- ---------------------------------------------------------------------------------------------
-- 4. Automatisations, jobs (file d'exécution idempotente).
-- ---------------------------------------------------------------------------------------------
create function codev_private.valid_timezone() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid IANA timezone' using errcode = '22023';
  end if;
  return new;
end $$;

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_id uuid not null references public.agents(id) on delete restrict,
  run_type text not null check (run_type ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  timezone text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  frequency text not null check (frequency in ('once','daily','weekly','monthly')),
  schedule jsonb not null default '{}'::jsonb check (jsonb_typeof(schedule) = 'object'),
  next_run_at timestamptz,
  last_run_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','error','completed','archived')),
  autonomy_policy smallint not null default 0 check (autonomy_policy between 0 and 1),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_due_idx on public.automations(next_run_at) where status = 'active';
create index automations_client_idx on public.automations(client_id);
create trigger automations_valid_timezone before insert or update of timezone on public.automations for each row execute function codev_private.valid_timezone();
create trigger automations_set_updated_at before update on public.automations for each row execute function public.set_updated_at();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations(id) on delete set null,
  run_type text not null check (run_type ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  agent_id uuid references public.agents(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_expires_at timestamptz,
  worker_id text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  trigger text not null default 'schedule' check (trigger in ('schedule','manual','assistant','system')),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  result jsonb,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queue_idx on public.jobs(status, scheduled_for);
create index jobs_automation_idx on public.jobs(automation_id, created_at desc);
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();

-- Réserve des jobs dus (SKIP LOCKED) ; les jobs dont le bail a expiré sont relancés ou échouent.
create function public.codev_claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof public.jobs
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if p_worker is null or char_length(p_worker) not between 1 and 120 then
    raise exception 'Invalid worker' using errcode = '22023';
  end if;
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = left('Bail expiré : exécution interrompue.' || coalesce(' ' || last_error, ''), 2000),
         lease_expires_at = null,
         worker_id = null,
         finished_at = case when attempts >= max_attempts then now() else null end
   where status = 'running' and lease_expires_at < now();

  return query
  with candidate as (
    select id from public.jobs
     where status = 'queued' and scheduled_for <= now()
     order by scheduled_for, created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker_id = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 900))),
         started_at = coalesce(j.started_at, now())
    from candidate
   where j.id = candidate.id
  returning j.*;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Rapports versionnés.
-- ---------------------------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('weekly','monthly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','ready_for_review','approved','sent','archived')),
  version integer not null default 1 check (version >= 1),
  title text not null default '' check (char_length(title) <= 200),
  summary text not null default '' check (char_length(summary) <= 4000),
  internal_content jsonb not null default '{}'::jsonb check (jsonb_typeof(internal_content) = 'object'),
  client_content jsonb not null default '{}'::jsonb check (jsonb_typeof(client_content) = 'object'),
  generated_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  approved_version integer,
  sent_at timestamptz,
  archived_at timestamptz,
  delivery jsonb not null default '{}'::jsonb check (jsonb_typeof(delivery) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_period_check check (period_end >= period_start),
  constraint reports_unique_period unique nulls not distinct (client_id, kind, period_start)
);
create index reports_status_idx on public.reports(status, period_start desc);
create trigger reports_set_updated_at before update on public.reports for each row execute function public.set_updated_at();

-- Une modification du contenu client après approbation invalide l'approbation.
create function codev_private.reports_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if old.status in ('sent','archived') and (new.client_content is distinct from old.client_content or new.internal_content is distinct from old.internal_content) then
    raise exception 'Sent or archived report content is frozen' using errcode = '55000';
  end if;
  if old.status = 'approved' and new.status = 'approved' and new.client_content is distinct from old.client_content then
    new.status := 'ready_for_review';
    new.approved_at := null;
    new.approved_by := null;
    new.approved_version := null;
  end if;
  if new.status = 'sent' and (old.status <> 'approved' or new.approved_version is distinct from new.version) then
    raise exception 'Only the approved version can be sent' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger reports_guard before update on public.reports for each row execute function codev_private.reports_guard();

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  version integer not null check (version >= 1),
  summary text not null default '',
  internal_content jsonb not null default '{}'::jsonb,
  client_content jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique (report_id, version)
);

-- ---------------------------------------------------------------------------------------------
-- 6. Agenda (les tâches restent dans tasks).
-- ---------------------------------------------------------------------------------------------
alter table public.tasks
  add column if not exists due_time time,
  add column if not exists duration_minutes integer;
alter table public.tasks add constraint tasks_duration_check check (duration_minutes is null or duration_minutes between 5 and 1440);

create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('event','meeting','work_block','check','automation')),
  title text not null check (char_length(title) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 4000),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  automation_id uuid references public.automations(id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  timezone text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  recurrence_until date,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agenda_items_starts_idx on public.agenda_items(starts_at);
create trigger agenda_items_valid_timezone before insert or update of timezone on public.agenda_items for each row execute function codev_private.valid_timezone();
create trigger agenda_items_set_updated_at before update on public.agenda_items for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 7. Incidents, contrôles de sites, métriques fournisseurs.
-- ---------------------------------------------------------------------------------------------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  source text not null check (source in ('monitoring','seo','ads','publications','system')),
  severity text not null default 'medium' check (severity in ('info','low','medium','high','critical')),
  title text not null check (char_length(title) between 1 and 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  fingerprint text not null check (char_length(fingerprint) between 1 and 200),
  status text not null default 'open' check (status in ('open','investigating','resolved')),
  recommendation_id uuid references public.recommendations(id) on delete set null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index incidents_open_fingerprint_unique on public.incidents(fingerprint) where status <> 'resolved';
create index incidents_client_idx on public.incidents(client_id, status);
create trigger incidents_set_updated_at before update on public.incidents for each row execute function public.set_updated_at();
alter table public.actions add constraint actions_incident_id_fkey foreign key (incident_id) references public.incidents(id) on delete set null;

create table public.site_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2048),
  checked_at timestamptz not null default now(),
  ok boolean not null,
  status_code integer,
  response_ms integer check (response_ms is null or response_ms >= 0),
  error_kind text check (error_kind is null or char_length(error_kind) <= 60),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  job_id uuid references public.jobs(id) on delete set null
);
create index site_checks_client_idx on public.site_checks(client_id, checked_at desc);

create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,40}$'),
  metric_key text not null check (char_length(metric_key) between 1 and 80),
  period_start date not null,
  period_end date not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  fetched_at timestamptz not null default now(),
  constraint metric_snapshots_unique unique nulls not distinct (client_id, provider, metric_key, period_start, period_end)
);

-- ---------------------------------------------------------------------------------------------
-- 8. Veille tech & IA.
-- ---------------------------------------------------------------------------------------------
create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id text not null check (source_id ~ '^[a-z0-9][a-z0-9_-]{1,60}$'),
  source_name text not null check (char_length(source_name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 400),
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  category text not null check (category in ('IA','Développement','SEO','Ads','Web')),
  summary text not null default '' check (char_length(summary) <= 1200),
  published_at timestamptz,
  score numeric(6,2) not null default 0,
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 128),
  fetched_at timestamptz not null default now()
);
create index news_items_rank_idx on public.news_items(published_at desc, score desc);

-- ---------------------------------------------------------------------------------------------
-- 9. Connexions : la table existante accepte désormais les connexions globales.
-- ---------------------------------------------------------------------------------------------
alter table public.client_connections alter column client_id drop not null;
alter table public.client_connections
  add column if not exists scope text not null default 'client',
  add column if not exists scopes text[] not null default '{}',
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_error text;
alter table public.client_connections
  add constraint client_connections_scope_check check ((scope = 'client' and client_id is not null) or (scope = 'global' and client_id is null)),
  add constraint client_connections_last_error_check check (last_error is null or char_length(last_error) <= 500);
create unique index client_connections_global_provider_unique on public.client_connections(provider) where client_id is null;

-- ---------------------------------------------------------------------------------------------
-- 10. Historique conservé + privilèges serveur uniquement.
-- ---------------------------------------------------------------------------------------------
create function codev_private.append_only() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  raise exception 'History must be retained' using errcode = '55000';
end $$;
create trigger report_versions_append_only before update or delete on public.report_versions for each row execute function codev_private.append_only();
do $$ declare t text; begin
  foreach t in array array['jobs','reports','incidents'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function agent_scope_private.prevent_history_delete()', t || '_retain_history', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['automations','jobs','reports','report_versions','agenda_items','incidents','site_checks','metric_snapshots','news_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke truncate on table public.%I from service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on public.automations, public.agenda_items, public.site_checks, public.metric_snapshots, public.news_items to service_role;
grant select, insert, update on public.jobs, public.reports, public.incidents to service_role;
grant select, insert on public.report_versions to service_role;
-- Les privilèges par défaut accordent DELETE : retrait explicite sur l'historique.
revoke delete on public.jobs, public.reports, public.incidents from service_role;
revoke update, delete on public.report_versions from service_role;

revoke all on function public.codev_claim_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.codev_claim_jobs(text, integer, integer) to service_role;
revoke all on all functions in schema codev_private from public, anon, authenticated;
grant execute on all functions in schema codev_private to service_role;

comment on table public.jobs is 'Exécutions planifiées ou manuelles. Idempotentes (idempotency_key), réservées par codev_claim_jobs (SKIP LOCKED + bail).';
comment on table public.automations is 'Automatisations d''agents. Fuseau IANA par automatisation ; autonomie limitée à 0/1 en V1.';
comment on column public.client_connections.metadata is 'Métadonnées non sensibles uniquement. Jamais de jeton ni de secret.';
