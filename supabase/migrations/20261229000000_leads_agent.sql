-- Agent Leads : demandes de devis entrantes (formulaire du site, e-mail transféré, saisie manuelle), qualification,
-- première réponse rapide et relances. Additif et idempotent. Données personnelles des demandeurs : accès service_role
-- uniquement (RLS active, aucun droit anon/authenticated), purge automatique 3 ans après le dernier échange.

create table if not exists public.lead_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default false,
  -- Clé publique du formulaire (identifie le client, n'autorise rien d'autre que le dépôt d'une demande).
  form_key text not null unique check (form_key ~ '^[A-Za-z0-9_-]{24,64}$'),
  -- Origines autorisées à déposer depuis un navigateur (https://www.client.fr). Vide : dépôt serveur à serveur seulement.
  allowed_origins text[] not null default '{}' check (cardinality(allowed_origins) <= 10),
  -- Réponse automatique : la première réponse et les relances partent sans validation. Désactivée par défaut.
  auto_reply boolean not null default false,
  followups smallint not null default 2 check (followups between 0 and 2),
  -- Adresse de l'artisan prévenue à chaque nouvelle demande (résumé, sans pièce jointe).
  notify_email text check (notify_email is null or (char_length(notify_email) between 6 and 254 and notify_email = lower(notify_email))),
  -- Adresse de réponse des messages envoyés au demandeur (sinon celle de l'expéditeur du client).
  reply_to text check (reply_to is null or (char_length(reply_to) between 6 and 254 and reply_to = lower(reply_to))),
  -- Engagement de rappel confirmé par le client (ex. « sous 24 h ouvrées »). Jamais inventé : vide, rien n'est promis.
  callback_promise text check (callback_promise is null or char_length(callback_promise) between 2 and 120),
  phone text check (phone is null or char_length(phone) between 6 and 30),
  signature text check (signature is null or char_length(signature) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or char_length(updated_by) <= 120)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null check (source in ('form','email','manual')),
  state text not null default 'new' check (state in ('new','ready','contacted','answered','won','lost','closed','spam')),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email = lower(contact_email))),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 30),
  postcode text check (postcode is null or postcode ~ '^[0-9]{5}$'),
  city text check (city is null or char_length(city) <= 120),
  subject text check (subject is null or char_length(subject) <= 300),
  message text not null check (char_length(message) between 1 and 8000),
  page_url text check (page_url is null or char_length(page_url) <= 500),
  -- Qualification (agent) : prestation, urgence, délai, informations manquantes, preuves citées du message.
  service text check (service is null or char_length(service) <= 200),
  urgency text check (urgency is null or urgency in ('urgent','soon','flexible','unknown')),
  score text check (score is null or score in ('hot','warm','cold')),
  qualification jsonb not null default '{}'::jsonb check (jsonb_typeof(qualification) = 'object'),
  qualified_by text check (qualified_by is null or qualified_by in ('ai','rules','admin')),
  received_at timestamptz not null default now(),
  first_reply_at timestamptz,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  followups_sent smallint not null default 0 check (followups_sent between 0 and 2),
  answered_at timestamptz,
  closed_reason text check (closed_reason is null or char_length(closed_reason) <= 60),
  process_attempts smallint not null default 0 check (process_attempts between 0 and 20),
  notified_at timestamptz,
  -- Anti-abus du formulaire : empreinte de l'adresse IP (HMAC, jamais l'adresse elle-même) et doublon exact.
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{32,64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_fingerprint on public.leads(client_id, fingerprint);
create index if not exists leads_client_state on public.leads(client_id, state, received_at desc);
create index if not exists leads_followup_due on public.leads(next_followup_at) where next_followup_at is not null and state = 'contacted';
create index if not exists leads_pending on public.leads(received_at) where state = 'new';
create index if not exists leads_ip on public.leads(client_id, ip_hash, received_at) where ip_hash is not null;
create index if not exists leads_contact_email on public.leads(contact_email) where contact_email is not null;

create table if not exists public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  kind text not null check (kind in ('first_reply','followup','notify','inbound')),
  -- Rang : 0 première réponse, 1 et 2 relances ; notify / inbound : 0.
  step smallint not null default 0 check (step between 0 and 2),
  state text not null check (state in ('draft','approved','sending','sent','failed','cancelled','received')),
  recipient text check (recipient is null or char_length(recipient) <= 254),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 6000),
  draft_source text check (draft_source is null or draft_source in ('ai','template','admin')),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9:_-]{16,150}$'),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 120),
  error text check (error is null or char_length(error) <= 60),
  approved_by text check (approved_by is null or char_length(approved_by) <= 120),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Une seule première réponse et une seule relance de chaque rang par demande (reprise sans doublon).
create unique index if not exists lead_messages_one_per_step on public.lead_messages(lead_id, kind, step) where direction = 'out' and state <> 'cancelled';
create unique index if not exists lead_messages_idempotency on public.lead_messages(idempotency_key) where idempotency_key is not null;
create index if not exists lead_messages_lead on public.lead_messages(lead_id, created_at);
create index if not exists lead_messages_drafts on public.lead_messages(client_id, created_at) where state = 'draft';

alter table public.lead_settings enable row level security;
alter table public.leads enable row level security;
alter table public.lead_messages enable row level security;
revoke all on public.lead_settings, public.leads, public.lead_messages from anon, authenticated;

notify pgrst, 'reload schema';
