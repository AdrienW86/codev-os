-- Agent Newsletter : newsletters des clients rédigées par l'agent à partir de faits vérifiés (articles publiés,
-- prestations), relues et approuvées par un administrateur, puis envoyées aux seuls contacts consentants et non exclus.
-- Schéma additif. Le journal des envois (une ligne par destinataire, écrite avant l'appel au fournisseur) rend l'envoi
-- reprenable sans double envoi.
create table if not exists public.email_newsletters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','approved','sending','sent','cancelled')),
  subject text not null check (length(subject) between 3 and 120),
  preheader text not null default '' check (length(preheader) <= 200),
  content jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  audit jsonb not null default '{}'::jsonb,
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by text,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft','cancelled') or approved_at is not null)
);
create index if not exists email_newsletters_client on public.email_newsletters (client_id, created_at desc);

create table if not exists public.email_newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid not null references public.email_newsletters(id) on delete cascade,
  email_normalized text not null check (email_normalized = lower(email_normalized) and length(email_normalized) between 6 and 254),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  error text check (error is null or length(error) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (newsletter_id, email_normalized)
);
create index if not exists email_newsletter_sends_pending on public.email_newsletter_sends (newsletter_id, status);

-- Accès serveur uniquement (service_role + contrôle administrateur existant) ; aucun accès anon/authenticated.
alter table public.email_newsletters enable row level security;
alter table public.email_newsletter_sends enable row level security;
revoke all on public.email_newsletters, public.email_newsletter_sends from anon, authenticated;
notify pgrst, 'reload schema';
