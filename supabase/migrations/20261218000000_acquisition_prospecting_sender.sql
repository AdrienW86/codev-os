-- Prospection e-mail, PR 1 : expéditeur de prospection sur un domaine dédié (Resend, SPF/DKIM vérifiés).
-- Additif et idempotent. Aucune donnée existante modifiée (aucun expéditeur en production au 2026-11-19).
-- La prospection ne part jamais du domaine principal : contrôle applicatif (lib/acquisition/prospecting-sender.ts).

alter table public.acquisition_senders drop constraint if exists acquisition_senders_provider_check;
alter table public.acquisition_senders add constraint acquisition_senders_provider_check
  check (provider in ('infomaniak','google_workspace','smtp','api','resend'));

alter table public.acquisition_senders
  add column if not exists from_name text check (from_name is null or char_length(from_name) <= 80),
  add column if not exists sending_domain text check (sending_domain is null or sending_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  add column if not exists reply_to text check (reply_to is null or char_length(reply_to) <= 254),
  add column if not exists legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  add column if not exists legal_address text check (legal_address is null or char_length(legal_address) <= 240),
  add column if not exists privacy_url text check (privacy_url is null or privacy_url ~ '^https://'),
  add column if not exists provider_domain_id text,
  add column if not exists domain_status text not null default 'not_started'
    check (domain_status in ('not_started','pending','verified','failed','temporary_failure')),
  add column if not exists dns_records jsonb not null default '[]'::jsonb,
  add column if not exists domain_checked_at timestamptz,
  add column if not exists warmup_started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Un seul expéditeur Resend par espace ; un domaine d'envoi n'appartient qu'à un espace.
create unique index if not exists acquisition_senders_one_resend_per_workspace
  on public.acquisition_senders(workspace_id) where provider = 'resend';
create unique index if not exists acquisition_senders_sending_domain_unique
  on public.acquisition_senders(sending_domain) where sending_domain is not null;

notify pgrst, 'reload schema';
