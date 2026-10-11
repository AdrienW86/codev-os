-- Contrôles SQL de l'intégration Google Search Console (base locale isolée uniquement, transaction annulée).
begin;
create temporary table sc_checks(passed integer not null);
insert into sc_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Search Console check failed: %', label; end if;
  update pg_temp.sc_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'Search Console check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id, name) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'Client A'), ('aaaaaaaa-0000-4000-8000-0000000000c2', 'Client B');

-- Connexion globale (compte Google de l'agence) et propriétés par client, sur la table existante.
insert into public.client_connections(client_id, provider, scope, status, metadata, scopes, credential_reference, connected_at)
values (null, 'search-console', 'global', 'active', '{}', array['https://www.googleapis.com/auth/webmasters.readonly'], 'vault:connection/11111111-1111-4111-8111-111111111111', now());
select pg_temp.fails($$insert into public.client_connections(client_id, provider, scope, status, metadata) values (null, 'search-console', 'global', 'active', '{}')$$, '23505', 'one global Search Console connection');
insert into public.client_connections(client_id, provider, scope, status, metadata) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'search-console', 'client', 'configured', '{"property":"sc-domain:exemple.fr"}');
select pg_temp.fails($$insert into public.client_connections(client_id, provider, status, metadata, credential_reference) values ('aaaaaaaa-0000-4000-8000-0000000000c2', 'search-console', 'active', '{}', 'refresh-token-in-clear')$$, '23514', 'no secret in credential_reference');

-- Secrets chiffrés : format de référence, fournisseur, immuables, invisibles des rôles publics.
insert into public.integration_credential_secrets(reference, provider, key_id, iv, ciphertext, auth_tag)
values ('vault:connection/11111111-1111-4111-8111-111111111111', 'search-console', 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('ab', 40), 'hex'), decode(repeat('cd', 16), 'hex'));
select pg_temp.fails($$update public.integration_credential_secrets set key_id = 'k2'$$, '55000', 'secrets immutable');
select pg_temp.fails($$insert into public.integration_credential_secrets(reference, provider, key_id, iv, ciphertext, auth_tag) values ('vault:connection/22222222-2222-4222-8222-222222222222', 'meta', 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('ab', 40), 'hex'), decode(repeat('cd', 16), 'hex'))$$, '23514', 'secret store limited to Search Console');
select pg_temp.fails($$insert into public.integration_credential_secrets(reference, provider, key_id, iv, ciphertext, auth_tag) values ('ya29.token', 'search-console', 'k1', decode(repeat('00', 12), 'hex'), decode(repeat('ab', 40), 'hex'), decode(repeat('cd', 16), 'hex'))$$, '23514', 'opaque reference only');
delete from public.integration_credential_secrets where reference = 'vault:connection/11111111-1111-4111-8111-111111111111';
select pg_temp.ok(not exists(select 1 from public.integration_credential_secrets), 'secret deletable on disconnect');
select pg_temp.ok(not has_table_privilege('anon', 'public.integration_credential_secrets', 'SELECT') and not has_table_privilege('authenticated', 'public.integration_credential_secrets', 'SELECT'), 'secrets hidden from public roles');
select pg_temp.ok(not has_table_privilege('service_role', 'public.integration_credential_secrets', 'UPDATE'), 'service role cannot update secrets');

-- États OAuth : usage unique, durée bornée, conservés.
insert into public.integration_oauth_states(state_hash, provider, actor_id, expires_at) values (repeat('a', 64), 'search-console', 'user_admin', now() + interval '10 minutes');
select pg_temp.fails($$insert into public.integration_oauth_states(state_hash, provider, actor_id, expires_at) values (repeat('b', 64), 'search-console', 'user_admin', now() + interval '1 hour')$$, '23514', 'state TTL bounded');
select pg_temp.fails($$insert into public.integration_oauth_states(state_hash, provider, actor_id, expires_at) values ('plain-state', 'search-console', 'user_admin', now() + interval '1 minute')$$, '23514', 'only the state hash is stored');
update public.integration_oauth_states set consumed_at = now() where state_hash = repeat('a', 64) and consumed_at is null;
select pg_temp.ok((select consumed_at is not null from public.integration_oauth_states where state_hash = repeat('a', 64)), 'state consumed once');
select pg_temp.fails($$update public.integration_oauth_states set consumed_at = now() where state_hash = repeat('a', 64)$$, '55000', 'state never consumed twice');
select pg_temp.fails($$delete from public.integration_oauth_states$$, '55000', 'states kept for audit');

-- Historique quotidien : pas de doublon, pas de clic sans impression, propriété valide.
insert into public.search_console_daily_metrics(client_id, property, date, clicks, impressions, position) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', '2026-10-01', 12, 400, 8.4);
insert into public.search_console_daily_metrics(client_id, property, date, clicks, impressions, position) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', '2026-10-01', 13, 410, 8.1)
 on conflict (client_id, property, date) do update set clicks = excluded.clicks, impressions = excluded.impressions, position = excluded.position;
select pg_temp.ok((select count(*) = 1 and sum(clicks) = 13 from public.search_console_daily_metrics), 'daily upsert replaces, no duplicate');
select pg_temp.fails($$insert into public.search_console_daily_metrics(client_id, property, date, clicks, impressions) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', '2026-10-02', 5, 2)$$, '23514', 'clicks never exceed impressions');
select pg_temp.fails($$insert into public.search_console_daily_metrics(client_id, property, date, clicks, impressions) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'javascript:alert(1)', '2026-10-02', 0, 2)$$, '23514', 'property format');
insert into public.search_console_daily_metrics(client_id, property, date, clicks, impressions) values ('aaaaaaaa-0000-4000-8000-0000000000c2', 'https://www.exemple.fr/', '2026-10-01', 0, 3);
select pg_temp.ok((select count(*) = 2 from public.search_console_daily_metrics), 'same date kept per client');

-- Synchronisations : une seule quotidienne en cours ou réussie par client et par jour ; un échec permet de réessayer.
insert into public.search_console_sync_runs(client_id, property, trigger, sync_date, status, error_kind, finished_at) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'daily', '2026-10-11', 'failed', 'rate_limited', now());
insert into public.search_console_sync_runs(client_id, property, trigger, sync_date) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'daily', '2026-10-11');
select pg_temp.fails($$insert into public.search_console_sync_runs(client_id, property, trigger, sync_date) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'daily', '2026-10-11')$$, '23505', 'no concurrent daily sync');
insert into public.search_console_sync_runs(client_id, property, trigger, sync_date) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'manual', '2026-10-11');
select pg_temp.fails($$insert into public.search_console_sync_runs(client_id, property, trigger, sync_date, status) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'manual', '2026-10-11', 'succeeded')$$, '23514', 'finished run has an end date');
select pg_temp.fails($$insert into public.search_console_sync_runs(client_id, property, trigger, sync_date, status, error_kind, finished_at) values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'sc-domain:exemple.fr', 'manual', '2026-10-11', 'failed', 'Token ya29 leaked', now())$$, '23514', 'error kind only, never provider text');

select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('integration_credential_secrets','integration_oauth_states','search_console_daily_metrics','search_console_sync_runs')), 'RLS enabled');
select pg_temp.ok(not exists(select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')
  and table_name in ('integration_credential_secrets','integration_oauth_states','search_console_daily_metrics','search_console_sync_runs')), 'no public grants');

select 'SEARCH_CONSOLE_CHECKS=' || passed from pg_temp.sc_checks;
rollback;
