-- Agent Prospection multi-sources : balayage complet d'une zone (Sirene, en tâche de fond),
-- enrichissement OpenStreetMap, BODACC et lecture des sites web (e-mail générique uniquement).
-- Additif. Dépend de 20261107000000_acquisition_foundation et 20261203000000_acquisition_prescribers.

alter table public.acquisition_prospects drop constraint if exists acquisition_prospects_category_check;
alter table public.acquisition_prospects add constraint acquisition_prospects_category_check check (category in
  ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs','prescriber','zone_company'));
alter table public.acquisition_templates drop constraint if exists acquisition_templates_category_check;
alter table public.acquisition_templates add constraint acquisition_templates_category_check check (category in
  ('platform_shutdown','site_issues','no_professional_site','agency_partner','digital_needs','prescriber','zone_company'));

alter table public.acquisition_prospects
  -- OpenStreetMap (ODbL) : identifiant de l'objet et coordonnées publiées.
  add column if not exists osm_ref text,
  add column if not exists osm_website text,
  add column if not exists osm_phone text,
  add column if not exists osm_checked_at timestamptz,
  -- BODACC : date de l'annonce de création et lien vers l'annonce.
  add column if not exists bodacc_created_on date,
  add column if not exists bodacc_url text,
  -- Site web de l'entreprise : uniquement une adresse générique (contact@, info@…) du domaine.
  add column if not exists contact_email text
    check (contact_email is null or contact_email ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$'),
  add column if not exists contact_email_source text,
  add column if not exists website_checked_at timestamptz,
  add column if not exists website_status text
    check (website_status is null or website_status in ('ok','robots_disallowed','unreachable','blocked_address','invalid')),
  add column if not exists legal_id_confirmed boolean;

create index if not exists acquisition_prospects_website_queue_idx
  on public.acquisition_prospects(workspace_id) where website_checked_at is null;

alter table public.acquisition_discovery_runs
  add column if not exists mode text not null default 'prescribers' check (mode in ('prescribers','zone')),
  add column if not exists phase text not null default 'done'
    check (phase in ('sirene_zone','osm','bodacc','websites','done')),
  add column if not exists options jsonb not null default '{}'::jsonb,
  add column if not exists cursor jsonb not null default '{}'::jsonb,
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists departement text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.acquisition_discovery_runs drop constraint if exists acquisition_discovery_runs_status_check;
alter table public.acquisition_discovery_runs add constraint acquisition_discovery_runs_status_check
  check (status in ('queued','running','enriching','succeeded','failed','cancelled'));

-- Une seule recherche en tâche de fond à la fois par espace.
create unique index if not exists acquisition_discovery_runs_one_active_idx
  on public.acquisition_discovery_runs(workspace_id) where status in ('queued','running','enriching');
create index if not exists acquisition_discovery_runs_active_idx
  on public.acquisition_discovery_runs(updated_at) where status in ('queued','running','enriching');

notify pgrst, 'reload schema';
