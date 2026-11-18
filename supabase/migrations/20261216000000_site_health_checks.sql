-- Architecture des agents, lot 5 : santé technique hebdomadaire des sites (Agent Monitoring).
-- Aucune donnée existante n'est modifiée. Sans cette migration, le contrôle ne tourne pas (comportement d'avant).
-- site_health_checks : un contrôle par site et par semaine (certificat, domaine, DNS, robots.txt, sitemap, pages,
--   Core Web Vitals réels, indexation Google). checks : état de chaque contrôle ; findings : constats et corrections.
create table if not exists public.site_health_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2048),
  score integer not null check (score between 0 and 100),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  checked_at timestamptz not null default now()
);
create index if not exists site_health_checks_client_idx on public.site_health_checks (client_id, checked_at desc);

alter table public.site_health_checks enable row level security;
revoke all on public.site_health_checks from public, anon, authenticated;
grant select, insert on public.site_health_checks to service_role;
