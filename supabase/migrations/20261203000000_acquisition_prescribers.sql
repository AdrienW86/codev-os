-- Agent Prospection : entreprises prescriptrices trouvées pour un client
-- (ex. couvreur à Lyon → architectes, syndics, agences immobilières…).
-- Additif uniquement. Dépend de 20261107000000_acquisition_foundation.sql.
-- Données d'entreprises issues de sources publiques (Sirene) ; aucun dirigeant
-- ni e-mail nominatif n'est stocké.

alter table public.acquisition_prospects
  drop constraint if exists acquisition_prospects_category_check;
alter table public.acquisition_prospects
  add constraint acquisition_prospects_category_check check (category in
    ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs','prescriber'));

alter table public.acquisition_templates
  drop constraint if exists acquisition_templates_category_check;
alter table public.acquisition_templates
  add constraint acquisition_templates_category_check check (category in
    ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs','prescriber'));

alter table public.acquisition_prospects
  add column if not exists data_source text not null default 'manual'
    check (data_source in ('manual','sirene')),
  add column if not exists siren text check (siren is null or siren ~ '^[0-9]{9}$'),
  add column if not exists siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  add column if not exists naf_code text check (naf_code is null or naf_code ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
  add column if not exists segment text,
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists distance_km numeric(6,1) check (distance_km is null or distance_km >= 0),
  add column if not exists employee_range text,
  add column if not exists is_sole_proprietor boolean not null default false,
  -- Google Places : seul l'identifiant peut être conservé sans limite (CGU Google).
  -- Site et téléphone issus de Places sont effacés après 30 jours.
  add column if not exists google_place_id text,
  add column if not exists places_website text,
  add column if not exists places_phone text,
  add column if not exists places_enriched_at timestamptz,
  add constraint acquisition_prospects_sirene_source check (data_source <> 'sirene' or siren is not null);

-- Index unique complet (les SIREN nuls restent distincts) : requis par ON CONFLICT.
create unique index if not exists acquisition_prospects_workspace_siren_idx
  on public.acquisition_prospects(workspace_id, siren);
create index if not exists acquisition_prospects_places_expiry_idx
  on public.acquisition_prospects(places_enriched_at) where places_enriched_at is not null;

create table if not exists public.acquisition_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acquisition_workspaces(id) on delete cascade,
  trade_profile text not null,
  place text not null,
  commune_code text,
  radius_km integer not null check (radius_km between 1 and 50),
  segments text[] not null default '{}',
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  found_count integer not null default 0 check (found_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  api_requests integer not null default 0 check (api_requests >= 0),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists acquisition_discovery_runs_workspace_idx
  on public.acquisition_discovery_runs(workspace_id, created_at desc);

alter table public.acquisition_discovery_runs enable row level security;
revoke all on public.acquisition_discovery_runs from anon, authenticated;
notify pgrst, 'reload schema';
