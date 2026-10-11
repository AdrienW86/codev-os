-- Google Search Console : connexion OAuth (compte Google de l'agence), historique quotidien et traces de synchronisation.
-- Additive uniquement : aucune table, colonne, donnée ou contrainte existante n'est modifiée ou supprimée.
--
-- Modèle :
--  * client_connections (existant) : une ligne GLOBALE provider='search-console' (client_id null, scope='global') porte
--    l'état de la connexion OAuth et la RÉFÉRENCE opaque du jeton (vault:connection/<uuid>) ; les lignes par client
--    (existantes) portent la propriété associée dans metadata.property. Aucune colonne ajoutée.
--  * integration_credential_secrets : jeton de rafraîchissement chiffré (AES-256-GCM côté serveur, clé hors base).
--    Table distincte de publication_credential_secrets : les jetons Meta / Google Business Profile ne sont pas touchés.
--  * integration_oauth_states : états OAuth à usage unique (empreinte SHA-256 seulement), liés à l'administrateur.
--  * search_console_daily_metrics : totaux quotidiens par client et propriété (au-delà des 16 mois conservés par Google).
--  * search_console_sync_runs : traces de synchronisation ; empêche deux synchronisations quotidiennes simultanées.
--  * metric_snapshots (existant) : instantanés par période (provider 'search-console', metric_key 'performance').

-- 1. Jetons chiffrés (serveur uniquement, lignes immuables : une rotation écrit une nouvelle référence).
create table public.integration_credential_secrets(
 reference text primary key check(reference ~ '^vault:connection/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 provider text not null check(provider in('search-console')),
 key_id text not null check(key_id ~ '^[a-z0-9_-]{1,40}$'),
 iv bytea not null check(octet_length(iv)=12),
 ciphertext bytea not null check(octet_length(ciphertext) between 16 and 65536),
 auth_tag bytea not null check(octet_length(auth_tag)=16),
 created_at timestamptz not null default now()
);
create function codev_private.integration_secret_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'Integration secrets are immutable: rotate to a new reference' using errcode='55000'; end $$;
create trigger integration_credential_secret_immutable before update on public.integration_credential_secrets
 for each row execute function codev_private.integration_secret_immutable();
alter table public.integration_credential_secrets enable row level security;
revoke all on public.integration_credential_secrets from public,anon,authenticated,service_role;
grant select,insert,delete on public.integration_credential_secrets to service_role;

-- 2. États OAuth : usage unique, 10 minutes, liés au fournisseur et à l'administrateur qui a lancé la connexion.
create table public.integration_oauth_states(
 id uuid primary key default gen_random_uuid(),
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 provider text not null check(provider in('search-console')),
 actor_id text not null check(actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check(consumed_at is null or consumed_at>=created_at)
);
create index integration_oauth_states_expiry on public.integration_oauth_states(expires_at) where consumed_at is null;
create function codev_private.integration_oauth_state_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'OAuth states are kept for audit' using errcode='55000'; end if;
 if (new.id,new.state_hash,new.provider,new.actor_id,new.created_at,new.expires_at)
   is distinct from (old.id,old.state_hash,old.provider,old.actor_id,old.created_at,old.expires_at)
  or old.consumed_at is not null or new.consumed_at is null then
  raise exception 'OAuth state is single use and immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger integration_oauth_state_guard before update or delete on public.integration_oauth_states
 for each row execute function codev_private.integration_oauth_state_guard();
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from public,anon,authenticated,service_role;
grant select,insert,update on public.integration_oauth_states to service_role;

-- 3. Totaux quotidiens Search Console (dates du fuseau de Google, données consolidées « final » uniquement).
-- Clé (client, propriété, date) : une resynchronisation remplace la ligne, jamais de doublon. Les données d'un client
-- ne sont jamais rattachées à un autre : la propriété est celle associée au client au moment de la collecte.
create table public.search_console_daily_metrics(
 client_id uuid not null references public.clients(id) on delete cascade,
 property text not null check(char_length(property) between 12 and 300 and property ~ '^(sc-domain:[a-z0-9.-]+|https?://[^\s]+/)$'),
 date date not null,
 clicks integer not null check(clicks>=0),
 impressions integer not null check(impressions>=0 and clicks<=impressions),
 position double precision check(position is null or position>=1),
 fetched_at timestamptz not null default now(),
 primary key(client_id,property,date)
);
alter table public.search_console_daily_metrics enable row level security;
revoke all on public.search_console_daily_metrics from public,anon,authenticated,service_role;
grant select,insert,update on public.search_console_daily_metrics to service_role;

-- 4. Traces de synchronisation : dernière réussite, erreurs normalisées (type uniquement), anti-doublon quotidien.
create table public.search_console_sync_runs(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 property text not null check(char_length(property) between 12 and 300),
 trigger text not null check(trigger in('daily','manual','dashboard')),
 sync_date date not null,
 status text not null default 'running' check(status in('running','succeeded','failed')),
 error_kind text check(error_kind is null or error_kind ~ '^[a-z_]{1,40}$'),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 check((status='running')=(finished_at is null))
);
-- Une seule synchronisation quotidienne en cours ou réussie par client et par jour ; un échec n'empêche pas de réessayer.
create unique index search_console_sync_runs_daily_once on public.search_console_sync_runs(client_id,sync_date) where trigger='daily' and status<>'failed';
create index search_console_sync_runs_recent on public.search_console_sync_runs(client_id,started_at desc);
alter table public.search_console_sync_runs enable row level security;
revoke all on public.search_console_sync_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.search_console_sync_runs to service_role;

revoke all on function codev_private.integration_secret_immutable(),codev_private.integration_oauth_state_guard() from public,anon,authenticated;

comment on table public.integration_credential_secrets is 'Jetons OAuth chiffrés (AES-256-GCM, clé serveur). Jamais lisibles en clair en base.';
comment on table public.integration_oauth_states is 'États OAuth à usage unique (empreinte SHA-256), 10 minutes, liés à l''administrateur.';
comment on table public.search_console_daily_metrics is 'Totaux quotidiens Search Console consolidés par client et propriété.';
comment on table public.search_console_sync_runs is 'Synchronisations Search Console : statut, type d''erreur, une synchronisation quotidienne par client et par jour.';
