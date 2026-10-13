-- Acquisition foundation, intentionally disabled by default.
-- Additive schema only. NEVER enables dispatch, discovery or prospecting.
create table if not exists public.acquisition_workspaces (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references public.clients(id) on delete restrict,
  label text not null,
  is_internal boolean not null default false,
  discovery_enabled boolean not null default false,
  sending_enabled boolean not null default false,
  emergency_stop boolean not null default true,
  daily_send_limit integer not null default 0 check (daily_send_limit between 0 and 1000),
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists acquisition_one_internal_workspace
  on public.acquisition_workspaces (is_internal) where is_internal;

create table if not exists public.acquisition_prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  company_name text not null,
  website text,
  domain_normalized text,
  category text not null check (category in
    ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs')),
  stage text not null default 'discovered' check (stage in
    ('discovered','verified','qualified','draft_ready','approved','contacted','responded','won','lost','excluded')),
  score integer check (score between 0 and 100),
  explanation text,
  source_url text,
  source_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);
create unique index if not exists acquisition_prospects_domain_unique
  on public.acquisition_prospects(workspace_id,domain_normalized)
  where domain_normalized is not null;
create index if not exists acquisition_prospects_queue
  on public.acquisition_prospects(workspace_id,stage,created_at desc);

create table if not exists public.acquisition_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  prospect_id uuid not null,
  signal_type text not null,
  source_url text not null,
  observation text not null,
  observed_at timestamptz not null default now(),
  foreign key (workspace_id,prospect_id) references public.acquisition_prospects(workspace_id,id) on delete cascade
);
create index if not exists acquisition_evidence_lookup on public.acquisition_evidence(workspace_id,prospect_id);

create table if not exists public.acquisition_senders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  address text not null,
  provider text not null check (provider in ('infomaniak','google_workspace','smtp','api')),
  status text not null default 'unconfigured' check (status in ('unconfigured','verification_pending','ready','paused')),
  credential_ref text,
  daily_limit integer not null default 0 check (daily_limit between 0 and 1000),
  created_at timestamptz not null default now(),
  unique(workspace_id,address),
  unique(workspace_id,id)
);
-- credential_ref stores an opaque pointer only. Never store passwords/tokens in this table.

create table if not exists public.acquisition_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  category text not null check (category in
    ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs')),
  name text not null,
  subject_template text not null,
  body_template text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique(workspace_id,id)
);

create table if not exists public.acquisition_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  prospect_id uuid not null,
  sender_id uuid,
  recipient_email text not null,
  subject text not null,
  body_text text not null,
  state text not null default 'draft' check (state in
    ('draft','approved','queued','sending','sent','failed','cancelled','suppressed')),
  approved_at timestamptz,
  scheduled_for timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id,prospect_id) references public.acquisition_prospects(workspace_id,id) on delete cascade,
  foreign key (workspace_id,sender_id) references public.acquisition_senders(workspace_id,id),
  check (state in ('draft','cancelled','suppressed','failed') or approved_at is not null)
);
create index if not exists acquisition_messages_queue on public.acquisition_messages(workspace_id,state,scheduled_for);

create table if not exists public.acquisition_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  email_normalized text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(workspace_id,email_normalized)
);

-- All access is server-side via service_role and existing single-admin checks.
-- Public anon/authenticated clients cannot read or mutate acquisition data.
alter table public.acquisition_workspaces enable row level security;
alter table public.acquisition_prospects enable row level security;
alter table public.acquisition_evidence enable row level security;
alter table public.acquisition_senders enable row level security;
alter table public.acquisition_templates enable row level security;
alter table public.acquisition_messages enable row level security;
alter table public.acquisition_suppressions enable row level security;
revoke all on public.acquisition_workspaces,public.acquisition_prospects,public.acquisition_evidence,
  public.acquisition_senders,public.acquisition_templates,public.acquisition_messages,
  public.acquisition_suppressions from anon,authenticated;
notify pgrst, 'reload schema';
