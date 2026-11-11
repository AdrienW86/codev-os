-- Pilote automatique Google Ads : réglage par client (désactivé par défaut) et journal immuable des
-- modifications appliquées par l'agent, avec annulation. Additive, sans effet sur les données existantes.
create table if not exists public.ads_autopilot_settings (
 client_id uuid primary key references public.clients(id) on delete cascade,
 mode text not null default 'off' check (mode in ('off','negatives','extended')),
 max_negatives_per_campaign_week integer not null default 10 check (max_negatives_per_campaign_week between 1 and 25),
 updated_by text not null check (length(updated_by) between 1 and 256),
 updated_at timestamptz not null default now()
);
create table if not exists public.ads_autopilot_changes (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 account_id text not null check (account_id ~ '^[0-9]{10}$'),
 campaign_id text not null check (campaign_id ~ '^[0-9]{1,20}$'),
 kind text not null default 'negative_keyword_add' check (kind in ('negative_keyword_add')),
 keyword text not null check (length(keyword) between 1 and 80),
 match_type text not null check (match_type in ('EXACT','PHRASE')),
 reason text not null check (reason in ('client_exclusion','off_target_waste')),
 evidence jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check (status in ('pending','applied','failed','uncertain','undone')),
 resource_name text check (resource_name ~ '^customers/[0-9]{10}/campaignCriteria/[0-9]+~[0-9]+$'),
 job_id uuid,
 created_at timestamptz not null default now(),
 applied_at timestamptz,
 undone_at timestamptz,
 undone_by text,
 error_code text check (error_code is null or length(error_code) <= 120)
);
create index if not exists ads_autopilot_changes_client_idx on public.ads_autopilot_changes(client_id, created_at desc);
-- Un même terme n'est jamais ajouté deux fois à la même campagne tant qu'il est actif.
create unique index if not exists ads_autopilot_changes_active_uniq on public.ads_autopilot_changes(client_id, campaign_id, lower(keyword), match_type) where status in ('pending','applied','uncertain');
alter table public.ads_autopilot_settings enable row level security;
alter table public.ads_autopilot_changes enable row level security;
revoke all on public.ads_autopilot_settings from public, anon, authenticated;
revoke all on public.ads_autopilot_changes from public, anon, authenticated;
grant select, insert, update on public.ads_autopilot_settings to service_role;
grant select, insert, update on public.ads_autopilot_changes to service_role;
notify pgrst, 'reload schema';
