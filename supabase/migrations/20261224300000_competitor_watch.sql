-- Agent Veille concurrence : réglages par client (veille active, concurrents à suivre saisis par l'administrateur).
-- Les rapports mensuels sont archivés dans metric_snapshots (provider « competitor-watch ») : aucune autre table.
-- Additif. Sans cette migration, la veille tourne avec les réglages par défaut (active, concurrents repérés sur
-- Google Maps) et l'écran indique que les réglages ne sont pas installés.

create table public.client_competitor_watch(
 client_id uuid primary key references public.clients(id) on delete cascade,
 enabled boolean not null default true,
 -- [{ "name": "…", "domain": "exemple.fr" | null }], 5 au plus.
 competitors jsonb not null default '[]'::jsonb check(jsonb_typeof(competitors)='array' and jsonb_array_length(competitors)<=5),
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.client_competitor_watch enable row level security;
revoke all on public.client_competitor_watch from public, anon, authenticated;
grant select, insert, update, delete on public.client_competitor_watch to service_role;
