-- Lot 1. Requires the existing public.clients(id uuid primary key).
-- Applied once by migration history; rebuild a disposable local DB to replay.
create schema publications_private;
revoke all on schema publications_private from public, anon, authenticated;
grant usage on schema publications_private to service_role;

create function publications_private.valid_slots(value jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_typeof(value) = 'array' and jsonb_array_length(value) = 2
    and not exists (select 1 from jsonb_array_elements(value) item
      where jsonb_typeof(item) <> 'object' or item - 'day' - 'time' <> '{}'::jsonb
        or jsonb_typeof(item->'day') is distinct from 'number'
        or coalesce(item->>'day', '') !~ '^[1-7]$'
        or coalesce(item->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    and value->0 <> value->1, false);
$$;

create function publications_private.safe_metadata(value jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  -- Closed vocabulary; nested values and arbitrary credentials are not accepted.
  select coalesce(jsonb_typeof(value) = 'object' and not exists (
    select 1 from jsonb_each(value) entry
    where entry.key not in ('label', 'locale', 'account_name', 'alt_text')
      or jsonb_typeof(entry.value) <> 'string' or length(entry.value #>> '{}') > 500
  ), false);
$$;

create table public.publication_settings (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  generation_enabled boolean not null default false,
  automation_enabled boolean not null default false,
  publishing_enabled boolean not null default false,
  emergency_stop boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_settings_singleton check (id = '00000000-0000-0000-0000-000000000001'),
  constraint publication_settings_stop_consistent check
    (not emergency_stop or not (generation_enabled or automation_enabled or publishing_enabled))
);
insert into public.publication_settings default values;

create table public.publication_client_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete restrict,
  timezone text not null default 'Europe/Paris',
  generation_enabled boolean not null default false,
  publishing_enabled boolean not null default false,
  editorial_brief text not null default '' check (length(editorial_brief) <= 10000),
  weekly_slots jsonb not null default '[{"day":2,"time":"10:00"},{"day":5,"time":"10:00"}]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint publication_client_slots check (publications_private.valid_slots(weekly_slots))
);

create table public.publication_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  platform text not null check (platform in ('google_business_profile','facebook','instagram')),
  external_account_id text check (length(external_account_id) between 1 and 300),
  status text not null default 'disconnected' check (status in ('disconnected','connected','error','revoked')),
  enabled boolean not null default false,
  credential_reference text check (credential_reference ~ '^ref:[a-zA-Z0-9/_-]{1,200}$'),
  metadata jsonb not null default '{}' check (publications_private.safe_metadata(metadata)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, client_id, platform), unique (client_id, platform, external_account_id),
  check (not enabled or (status = 'connected' and external_account_id is not null and credential_reference is not null))
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  editorial_week date not null check (extract(isodow from editorial_week) = 1),
  slot smallint not null check (slot in (1,2)),
  subject text not null check (length(btrim(subject)) between 1 and 300),
  status text not null default 'draft' check (status in ('draft','pending_review','approved','rejected')),
  current_revision_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (client_id, editorial_week, slot), unique (id, client_id),
  check (status = 'draft' or current_revision_id is not null)
);

create table public.publication_revisions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null, client_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  parent_revision_id uuid,
  origin text not null check (origin in ('manual','generated','regenerated')),
  regeneration_reason text check (length(regeneration_reason) <= 3000),
  model text check (length(model) <= 200),
  estimated_cost numeric(12,6) check (estimated_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (publication_id, client_id) references public.publications(id, client_id) on delete restrict,
  unique (publication_id, revision_number), unique (id, publication_id, client_id), unique (id, publication_id),
  foreign key (parent_revision_id, publication_id, client_id)
    references public.publication_revisions(id, publication_id, client_id) on delete restrict,
  check (parent_revision_id is null or parent_revision_id <> id)
);
alter table public.publications add constraint publications_current_revision_fk
  foreign key (current_revision_id, id, client_id)
  references public.publication_revisions(id, publication_id, client_id) on delete restrict;

create table public.publication_variants (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null, publication_id uuid not null, client_id uuid not null,
  platform text not null check (platform in ('google_business_profile','facebook','instagram')),
  text_content text not null check (length(btrim(text_content)) between 1 and 10000),
  metadata jsonb not null default '{}' check (publications_private.safe_metadata(metadata)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (revision_id, publication_id, client_id)
    references public.publication_revisions(id, publication_id, client_id) on delete restrict,
  unique (revision_id, platform), unique (id, client_id),
  unique (id, revision_id, publication_id, client_id),
  unique (id, publication_id, client_id, platform)
);

create table public.publication_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  storage_path text not null unique check
    (length(storage_path) between 1 and 500 and storage_path !~ '(^/|\.\.|://|\\)' and storage_path like client_id::text || '/%'),
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  width integer check (width > 0), height integer check (height > 0),
  provenance text not null check (length(btrim(provenance)) between 1 and 2000),
  rights_confirmed boolean not null default false,
  created_at timestamptz not null default now(), unique (id, client_id)
);

create table public.publication_variant_assets (
  variant_id uuid not null, asset_id uuid not null, client_id uuid not null,
  sort_order integer not null check (sort_order >= 0),
  primary key (variant_id, asset_id), unique (variant_id, sort_order),
  foreign key (variant_id, client_id) references public.publication_variants(id, client_id) on delete restrict,
  foreign key (asset_id, client_id) references public.publication_assets(id, client_id) on delete restrict
);

create table public.publication_reviews (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null, revision_id uuid not null, client_id uuid not null,
  variant_id uuid not null,
  decision text not null check (decision in ('approved','rejected')),
  reason text check (length(reason) <= 3000),
  actor_id text not null check (actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  created_at timestamptz not null default now(),
  unique (variant_id),
  foreign key (variant_id, revision_id, publication_id, client_id)
    references public.publication_variants(id, revision_id, publication_id, client_id) on delete restrict,
  check (decision <> 'rejected' or coalesce(length(btrim(reason)), 0) > 0)
);

create table public.publication_deliveries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null, client_id uuid not null,
  publication_account_id uuid not null, variant_id uuid not null,
  platform text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check
    (status in ('scheduled','processing','published','retryable_error','uncertain','blocked','cancelled')),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 200),
  remote_id text check (length(remote_id) between 1 and 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (publication_id, publication_account_id), unique (id, publication_id),
  unique (publication_account_id, remote_id),
  foreign key (publication_account_id, client_id, platform)
    references public.publication_accounts(id, client_id, platform) on delete restrict,
  foreign key (variant_id, publication_id, client_id, platform)
    references public.publication_variants(id, publication_id, client_id, platform) on delete restrict,
  check (status <> 'published' or remote_id is not null)
);

create table public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('generate','regenerate','deliver','reconcile')),
  publication_id uuid references public.publications(id) on delete restrict,
  delivery_id uuid, revision_id uuid,
  deduplication_key text not null unique check (length(btrim(deduplication_key)) between 1 and 200),
  run_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_at timestamptz, locked_by text check (length(locked_by) between 1 and 200),
  last_error text check (length(last_error) <= 1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, delivery_id),
  foreign key (delivery_id, publication_id) references public.publication_deliveries(id, publication_id) on delete restrict,
  foreign key (revision_id, publication_id) references public.publication_revisions(id, publication_id) on delete restrict,
  check (attempts <= max_attempts),
  check ((status = 'processing') = (locked_at is not null and locked_by is not null)),
  check ((locked_at is null) = (locked_by is null)),
  check (publication_id is not null),
  check ((type in ('deliver','reconcile') and delivery_id is not null)
    or (type in ('generate','regenerate') and delivery_id is null)),
  check (type <> 'regenerate' or revision_id is not null)
);

create table public.publication_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publication_jobs(id) on delete restrict,
  delivery_id uuid references public.publication_deliveries(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  result text not null check (result in ('succeeded','retryable_error','uncertain','blocked','failed')),
  sanitized_error text check (length(sanitized_error) <= 1000),
  request_id text check (request_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now(), unique (job_id, attempt_number)
);

create table public.publication_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('admin','system','worker')),
  actor_id text,
  action text not null check (action ~ '^publication[._][a-z0-9_.]{1,100}$'),
  client_id uuid references public.clients(id) on delete restrict,
  resource_type text not null check (length(resource_type) between 1 and 100),
  resource_id uuid not null, correlation_id uuid,
  before_data jsonb, after_data jsonb,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check ((actor_type = 'admin' and actor_id is not null and actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$')
    or (actor_type <> 'admin' and actor_id is null))
);

insert into public.publication_events(actor_type,action,resource_type,resource_id,after_data)
  values('system','publication.settings_initialized','publication_settings',
    '00000000-0000-0000-0000-000000000001',
    '{"generation_enabled":false,"automation_enabled":false,"publishing_enabled":false,"emergency_stop":true}');

create index publication_accounts_client_idx on public.publication_accounts(client_id);
create index publication_revisions_parent_idx on public.publication_revisions(parent_revision_id);
create index publication_variants_publication_idx on public.publication_variants(publication_id);
create index publication_assets_client_idx on public.publication_assets(client_id);
create index publication_variant_assets_asset_idx on public.publication_variant_assets(asset_id);
create index publication_reviews_publication_revision_idx on public.publication_reviews(publication_id, revision_id);
create index publication_deliveries_due_idx on public.publication_deliveries(status, scheduled_for);
create index publication_deliveries_variant_idx on public.publication_deliveries(variant_id);
create index publication_deliveries_account_idx on public.publication_deliveries(publication_account_id);
create index publication_jobs_due_idx on public.publication_jobs(run_at, id) where status = 'pending';
create index publication_jobs_status_due_idx on public.publication_jobs(status, run_at);
create index publication_jobs_publication_idx on public.publication_jobs(publication_id);
create index publication_jobs_delivery_idx on public.publication_jobs(delivery_id);
create index publication_jobs_revision_idx on public.publication_jobs(revision_id);
create index publication_attempts_delivery_idx on public.publication_attempts(delivery_id);
create index publication_events_resource_date_idx on public.publication_events(resource_type, resource_id, created_at desc);
create index publication_events_client_date_idx on public.publication_events(client_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['publication_settings','publication_client_settings','publication_accounts',
    'publications','publication_revisions','publication_variants','publication_assets','publication_variant_assets',
    'publication_reviews','publication_deliveries','publication_jobs','publication_attempts','publication_events'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update on table public.%I to service_role', table_name);
  end loop;
end;
$$;
revoke update on public.publication_events, public.publication_reviews, public.publication_revisions,
  public.publication_assets, public.publication_attempts from service_role;
revoke all on all functions in schema publications_private from public, anon, authenticated;
grant execute on all functions in schema publications_private to service_role;
