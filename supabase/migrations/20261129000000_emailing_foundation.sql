-- Socle emailing commun (newsletters des clients et prospection CODE-V). Schéma additif uniquement : aucune campagne,
-- aucun envoi. Contacts par client avec preuve de consentement, liste d'exclusion (désabonnements, rebonds définitifs,
-- plaintes) et journal idempotent des événements du fournisseur d'envoi (webhook Resend signé).
-- Portées d'exclusion : 'global' (rebond définitif ou plainte : plus aucun envoi, quel que soit l'expéditeur),
-- 'codev' (désabonnement de la prospection CODE-V), 'client' (désabonnement de la newsletter d'un client).
create table if not exists public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email_normalized text not null check (email_normalized = lower(email_normalized) and length(email_normalized) between 6 and 254),
  first_name text check (first_name is null or length(first_name) <= 100),
  last_name text check (last_name is null or length(last_name) <= 100),
  status text not null default 'subscribed' check (status in ('pending','subscribed','unsubscribed','bounced','complained')),
  -- Base légale : opt_in (case cochée), double_opt_in (confirmation par e-mail), customer (client existant, produits
  -- analogues, art. L34-5 CPCE), b2b_interest (adresse professionnelle, message lié à la fonction).
  consent_basis text not null check (consent_basis in ('opt_in','double_opt_in','customer','b2b_interest')),
  consent_source text not null check (length(consent_source) between 2 and 300),
  consent_at timestamptz not null,
  consent_evidence text check (consent_evidence is null or length(consent_evidence) <= 2000),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, email_normalized)
);
create index if not exists email_contacts_client_status on public.email_contacts (client_id, status);

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','codev','client')),
  client_id uuid references public.clients(id) on delete cascade,
  email_normalized text not null check (email_normalized = lower(email_normalized) and length(email_normalized) between 6 and 254),
  reason text not null check (reason in ('unsubscribe','hard_bounce','complaint','manual')),
  source text not null default 'system' check (length(source) between 2 and 100),
  created_at timestamptz not null default now(),
  check ((scope = 'client') = (client_id is not null))
);
create unique index if not exists email_suppressions_unique
  on public.email_suppressions (scope, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), email_normalized);
create index if not exists email_suppressions_lookup on public.email_suppressions (email_normalized);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend' check (provider in ('resend')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 60),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  email_normalized text check (email_normalized is null or length(email_normalized) <= 254),
  detail text check (detail is null or length(detail) <= 500),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists email_events_message on public.email_events (provider_message_id) where provider_message_id is not null;
create index if not exists email_events_recent on public.email_events (received_at desc);

-- Accès serveur uniquement (service_role + contrôle administrateur existant) ; aucun accès anon/authenticated.
alter table public.email_contacts enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_events enable row level security;
revoke all on public.email_contacts, public.email_suppressions, public.email_events from anon, authenticated;
notify pgrst, 'reload schema';
