-- Mémoire client partagée (socle éditorial, lot 1) : un registre de faits par client, chacun avec sa source et son
-- statut. C'est une table, pas un agent : aucun modèle ne réécrit un fait. Les agents ne lisent que les faits
-- confirmés ; une proposition (agent, message WhatsApp) attend la validation d'un administrateur.
create table public.client_facts(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 kind text not null check(kind in('company','service','zone','guarantee','certification','pricing','process','team','tone','exclusion','other')),
 statement text not null check(length(btrim(statement)) between 2 and 600),
 -- Empreinte normalisée (minuscules, sans accents ni ponctuation) : un même fait n'est enregistré qu'une fois.
 fingerprint text not null check(length(fingerprint) between 1 and 600),
 source text not null check(source in('client_record','admin','client_message','client_website','agent_proposal')),
 source_ref text check(source_ref is null or length(source_ref) <= 300),
 status text not null default 'proposed' check(status in('proposed','confirmed','rejected','archived')),
 confirmed_by text check(confirmed_by is null or confirmed_by ~ '^(user_[a-zA-Z0-9_-]{1,200}|system:client_record)$'),
 confirmed_at timestamptz,
 valid_until date,
 created_by text not null check(created_by ~ '^(user_[a-zA-Z0-9_-]{1,200}|system:[a-z_]{1,40}|agent:[a-z][a-z-]{1,30})$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(client_id, kind, fingerprint),
 check(status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)),
 -- Seuls les champs saisis par l'administrateur dans la fiche client sont confirmés sans validation explicite.
 check(confirmed_by is distinct from 'system:client_record' or source = 'client_record')
);
create index client_facts_client_status on public.client_facts(client_id, status, kind);
alter table public.client_facts enable row level security;
revoke all on public.client_facts from public, anon, authenticated;
grant select, insert, update on public.client_facts to service_role;
