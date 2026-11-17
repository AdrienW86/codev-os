-- Emailing, étape 2 : expéditeur et domaine d'envoi de chaque client (vérifié chez Resend : SPF, DKIM, DMARC).
-- Schéma additif uniquement, aucun envoi. Les contacts restent dans email_contacts (20261129000000).
create table if not exists public.client_email_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  -- Sous-domaine dédié recommandé (ex. news.client.fr) : la réputation du domaine principal reste protégée.
  sending_domain text check (sending_domain is null or (length(sending_domain) between 4 and 253
    and sending_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')),
  from_name text check (from_name is null or (length(from_name) between 1 and 80 and from_name !~ '[<>"\r\n]')),
  from_local_part text not null default 'newsletter' check (from_local_part ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'),
  reply_to text check (reply_to is null or (length(reply_to) between 6 and 254 and reply_to = lower(reply_to))),
  provider_domain_id text check (provider_domain_id is null or provider_domain_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  domain_status text not null default 'not_started'
    check (domain_status in ('not_started','pending','verified','failed','temporary_failure')),
  -- Enregistrements DNS à créer chez l'hébergeur du client (copie de la réponse Resend, sans secret).
  dns_records jsonb not null default '[]'::jsonb check (jsonb_typeof(dns_records) = 'array'),
  domain_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists client_email_settings_domain_unique
  on public.client_email_settings (sending_domain) where sending_domain is not null;

alter table public.client_email_settings enable row level security;
revoke all on public.client_email_settings from anon, authenticated;
notify pgrst, 'reload schema';
