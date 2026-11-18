-- Architecture des agents, lot 6 : référencement local (Agent SEO). Statistiques et avis des fiches Google Business
-- Profile, relevés chaque semaine en lecture seule. Aucune donnée existante n'est modifiée ; sans cette migration,
-- rien n'est relevé (comportement d'avant).
create table if not exists public.local_seo_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_name text not null check (location_name ~ '^accounts/[0-9A-Za-z_-]{1,100}/locations/[0-9A-Za-z_-]{1,100}$'),
  location_title text check (location_title is null or char_length(location_title) <= 200),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  metrics jsonb check (metrics is null or jsonb_typeof(metrics) = 'object'),
  previous_metrics jsonb check (previous_metrics is null or jsonb_typeof(previous_metrics) = 'object'),
  keywords jsonb check (keywords is null or jsonb_typeof(keywords) = 'array'),
  reviews jsonb check (reviews is null or jsonb_typeof(reviews) = 'object'),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  fetched_at timestamptz not null default now()
);
create index if not exists local_seo_snapshots_client_idx on public.local_seo_snapshots (client_id, fetched_at desc);

alter table public.local_seo_snapshots enable row level security;
revoke all on public.local_seo_snapshots from public, anon, authenticated;
grant select, insert on public.local_seo_snapshots to service_role;
