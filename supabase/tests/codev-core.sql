-- Contrôles SQL du noyau CODE-V OS V1 (base locale isolée uniquement, dans une transaction annulée).
begin;
create temporary table core_checks(passed integer not null);
insert into core_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Core check failed: %', label; end if;
  update pg_temp.core_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'Core check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Client test');
insert into public.agents(id, name, status, autonomy_level, enabled, agent_scope, agent_type)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'Agent test core', 'Actif', 1, true, 'client', 'test-agent');

-- Registre : tous les types du catalogue existent, autonomie ≤ 1, seuls Rapport et Veille actifs par défaut.
select pg_temp.ok((select count(distinct agent_type) from public.agents where agent_type in ('report','seo','google-ads','monitoring','automation','veille','publications')) >= 6, 'registry agents seeded');
select pg_temp.ok(not exists(select 1 from public.agents where agent_type in ('seo','google-ads','monitoring','automation') and enabled and name in ('Agent SEO & Site','Agent Google Ads','Agent Monitoring Technique','Agent Automatisation')), 'external agents seeded disabled');
select pg_temp.ok(not exists(select 1 from public.agents where agent_type is not null and autonomy_level > 1 and name like 'Agent %' and created_at > now() - interval '1 hour'), 'seeded autonomy <= 1');

-- Services : clé unique par client, cycle de vie contrôlé.
insert into public.client_services(client_id, service_type, service_key, lifecycle) values ('aaaaaaaa-0000-4000-8000-000000000001', 'SEO & visibilité locale', 'seo', 'active');
select pg_temp.fails($$insert into public.client_services(client_id, service_type, service_key) values ('aaaaaaaa-0000-4000-8000-000000000001', 'SEO bis', 'seo')$$, '23505', 'service key unique per client');
select pg_temp.fails($$update public.client_services set lifecycle = 'deleted' where service_key = 'seo'$$, '23514', 'lifecycle check');
insert into public.agent_client_assignments(agent_id, client_id, source, service_key) values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'service', 'seo');
select pg_temp.fails($$update public.agent_client_assignments set source = 'robot'$$, '23514', 'assignment source check');

-- Actions : hachage, gel à l'approbation, exécution seulement si inchangée.
insert into public.actions(id, agent_id, client_id, action_type, parameters, status, requires_approval)
values ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'seo.publish_page', '{"page":"aides-2026"}', 'pending_approval', true);
select pg_temp.ok((select payload_hash = codev_private.payload_hash('{"page":"aides-2026"}') from public.actions where id = 'cccccccc-0000-4000-8000-000000000001'), 'payload hash computed');
update public.actions set parameters = '{"page":"aides-2026-v2"}' where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.ok(true, 'pending payload may still change');
update public.actions set status = 'approved', approved_by = 'admin' where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.ok((select approved_payload_hash = payload_hash and approved_at is not null from public.actions where id = 'cccccccc-0000-4000-8000-000000000001'), 'approval freezes hash');
select pg_temp.fails($$update public.actions set parameters = '{"page":"autre"}' where id = 'cccccccc-0000-4000-8000-000000000001'$$, '55000', 'approved payload frozen');
update public.actions set status = 'executing' where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.ok((select status = 'executing' from public.actions where id = 'cccccccc-0000-4000-8000-000000000001'), 'unchanged approved action executes');
insert into public.actions(id, agent_id, client_id, action_type, parameters, status, requires_approval)
values ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'internal.test', '{}', 'pending_approval', true);
select pg_temp.fails($$update public.actions set status = 'executing' where id = 'cccccccc-0000-4000-8000-000000000002'$$, '55000', 'unapproved action cannot execute');
select pg_temp.fails($$update public.actions set status = 'whatever' where id = 'cccccccc-0000-4000-8000-000000000002'$$, '23514', 'action status check');
select pg_temp.fails($$delete from public.actions where id = 'cccccccc-0000-4000-8000-000000000002'$$, '55000', 'action history retained');

-- Automatisations : fuseau IANA validé, autonomie plafonnée.
select pg_temp.fails($$insert into public.automations(name, agent_id, run_type, frequency, timezone) values ('x', 'bbbbbbbb-0000-4000-8000-000000000001', 'report.generate', 'weekly', 'Mars/Olympus')$$, '22023', 'invalid timezone rejected');
select pg_temp.fails($$insert into public.automations(name, agent_id, run_type, frequency, autonomy_policy) values ('x', 'bbbbbbbb-0000-4000-8000-000000000001', 'report.generate', 'weekly', 2)$$, '23514', 'autonomy capped at 1');
select pg_temp.fails($$insert into public.automations(name, agent_id, run_type, frequency) values ('x', 'bbbbbbbb-0000-4000-8000-000000000001', 'rm -rf /', 'weekly')$$, '23514', 'run type format');
insert into public.automations(id, name, agent_id, run_type, frequency, timezone, next_run_at, schedule)
values ('dddddddd-0000-4000-8000-000000000001', 'Rapport', 'bbbbbbbb-0000-4000-8000-000000000001', 'report.generate', 'weekly', 'America/New_York', now() - interval '1 minute', '{"time":"08:00","weekdays":[1]}');

-- Jobs : idempotence, réservation, bail expiré, épuisement des tentatives.
insert into public.jobs(id, run_type, idempotency_key, automation_id) values ('eeeeeeee-0000-4000-8000-000000000001', 'report.generate', 'auto:dddddddd:2026-10-12T06:00Z', 'dddddddd-0000-4000-8000-000000000001');
insert into public.jobs(run_type, idempotency_key) values ('report.generate', 'auto:dddddddd:2026-10-12T06:00Z') on conflict (idempotency_key) do nothing;
select pg_temp.ok((select count(*) = 1 from public.jobs where idempotency_key = 'auto:dddddddd:2026-10-12T06:00Z'), 'duplicate tick creates one job');
insert into public.jobs(id, run_type, idempotency_key, scheduled_for) values ('eeeeeeee-0000-4000-8000-000000000002', 'news.fetch', 'future', now() + interval '1 day');
select pg_temp.ok((select count(*) = 1 from public.codev_claim_jobs('worker-a', 10, 60)), 'only due jobs are claimed');
select pg_temp.ok((select status = 'running' and attempts = 1 and worker_id = 'worker-a' from public.jobs where id = 'eeeeeeee-0000-4000-8000-000000000001'), 'claimed job running');
select pg_temp.ok((select count(*) = 0 from public.codev_claim_jobs('worker-b', 10, 60)), 'running job not claimed twice');
update public.jobs set lease_expires_at = now() - interval '1 second' where id = 'eeeeeeee-0000-4000-8000-000000000001';
select pg_temp.ok((select count(*) = 1 from public.codev_claim_jobs('worker-b', 10, 60)), 'stale job reclaimed');
select pg_temp.ok((select attempts = 2 and worker_id = 'worker-b' from public.jobs where id = 'eeeeeeee-0000-4000-8000-000000000001'), 'reclaim increments attempts');
update public.jobs set attempts = max_attempts, lease_expires_at = now() - interval '1 second' where id = 'eeeeeeee-0000-4000-8000-000000000001';
select count(*) from public.codev_claim_jobs('worker-c', 10, 60);
select pg_temp.ok((select status = 'failed' and finished_at is not null from public.jobs where id = 'eeeeeeee-0000-4000-8000-000000000001'), 'retry exhaustion fails the job');
select pg_temp.fails($$select public.codev_claim_jobs('', 1, 60)$$, '22023', 'worker id required');
select pg_temp.fails($$delete from public.jobs where id = 'eeeeeeee-0000-4000-8000-000000000002'$$, '55000', 'job history retained');
select pg_temp.fails($$insert into public.jobs(run_type, idempotency_key, payload) values ('x.y', 'big', jsonb_build_object('blob', repeat('x', 20000)))$$, '23514', 'oversized payload rejected');

-- Rapports : approbation invalidée par une modification, envoi de la version approuvée uniquement.
insert into public.reports(id, client_id, kind, period_start, period_end, status, client_content)
values ('ffffffff-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'weekly', '2026-10-05', '2026-10-11', 'ready_for_review', '{"summary":"v1"}');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end) values ('aaaaaaaa-0000-4000-8000-000000000001', 'weekly', '2026-10-05', '2026-10-11')$$, '23505', 'one report per client, kind and period');
select pg_temp.fails($$update public.reports set status = 'sent' where id = 'ffffffff-0000-4000-8000-000000000001'$$, '55000', 'unapproved report cannot be sent');
update public.reports set status = 'approved', approved_version = version, approved_by = 'admin', approved_at = now() where id = 'ffffffff-0000-4000-8000-000000000001';
update public.reports set client_content = '{"summary":"v1 modifié"}' where id = 'ffffffff-0000-4000-8000-000000000001';
select pg_temp.ok((select status = 'ready_for_review' and approved_at is null from public.reports where id = 'ffffffff-0000-4000-8000-000000000001'), 'edit after approval invalidates it');
update public.reports set status = 'approved', approved_version = version, approved_at = now() where id = 'ffffffff-0000-4000-8000-000000000001';
update public.reports set status = 'sent', sent_at = now() where id = 'ffffffff-0000-4000-8000-000000000001';
select pg_temp.fails($$update public.reports set client_content = '{"summary":"après envoi"}' where id = 'ffffffff-0000-4000-8000-000000000001'$$, '55000', 'sent report frozen');
insert into public.report_versions(report_id, version, client_content) values ('ffffffff-0000-4000-8000-000000000001', 1, '{"summary":"v1"}');
select pg_temp.fails($$update public.report_versions set summary = 'x'$$, '55000', 'report versions append-only');
select pg_temp.fails($$delete from public.reports where id = 'ffffffff-0000-4000-8000-000000000001'$$, '55000', 'report history retained');

-- Incidents : un seul incident ouvert par empreinte ; réouverture possible après résolution.
insert into public.incidents(client_id, source, title, fingerprint) values ('aaaaaaaa-0000-4000-8000-000000000001', 'monitoring', 'Site indisponible', 'site-down:client-test');
select pg_temp.fails($$insert into public.incidents(client_id, source, title, fingerprint) values ('aaaaaaaa-0000-4000-8000-000000000001', 'monitoring', 'Doublon', 'site-down:client-test')$$, '23505', 'duplicate open incident rejected');
update public.incidents set status = 'resolved', resolved_at = now() where fingerprint = 'site-down:client-test';
insert into public.incidents(client_id, source, title, fingerprint) values ('aaaaaaaa-0000-4000-8000-000000000001', 'monitoring', 'Site de nouveau indisponible', 'site-down:client-test');
select pg_temp.ok(true, 'resolved incident can reoccur');

-- Agenda, veille, connexions globales.
select pg_temp.fails($$insert into public.agenda_items(kind, title, starts_at, timezone) values ('meeting', 'x', now(), 'Nowhere/Land')$$, '22023', 'agenda timezone validated');
select pg_temp.fails($$insert into public.agenda_items(kind, title, starts_at, duration_minutes) values ('meeting', 'x', now(), 2)$$, '23514', 'agenda duration bounds');
insert into public.news_items(source_id, source_name, title, url, category, dedupe_key) values ('src', 'Source', 'Titre', 'https://exemple.fr/a', 'IA', 'dedupe-key-0001');
select pg_temp.fails($$insert into public.news_items(source_id, source_name, title, url, category, dedupe_key) values ('src', 'Source', 'Titre', 'https://exemple.fr/a', 'IA', 'dedupe-key-0001')$$, '23505', 'duplicate news rejected');
select pg_temp.fails($$insert into public.news_items(source_id, source_name, title, url, category, dedupe_key) values ('src', 'Source', 'Titre', 'http://exemple.fr/b', 'IA', 'dedupe-key-0002')$$, '23514', 'news url must be https');
insert into public.client_connections(provider, scope, client_id, status) values ('openai', 'global', null, 'configured');
select pg_temp.fails($$insert into public.client_connections(provider, scope, client_id, status) values ('openai', 'global', null, 'configured')$$, '23505', 'one global connection per provider');
select pg_temp.fails($$insert into public.client_connections(provider, scope, client_id) values ('vercel', 'client', null)$$, '23514', 'client connection needs a client');

-- Privilèges : aucun accès navigateur aux nouvelles tables ; service_role sans DELETE sur l'historique.
select pg_temp.ok(not exists(
  select 1 from information_schema.role_table_grants
   where grantee in ('anon','authenticated','PUBLIC')
     and table_name in ('automations','jobs','reports','report_versions','agenda_items','incidents','site_checks','metric_snapshots','news_items')), 'no browser privileges');
select pg_temp.ok(not has_table_privilege('service_role', 'public.jobs', 'DELETE') and not has_table_privilege('service_role', 'public.report_versions', 'UPDATE'), 'history privileges restricted');
select pg_temp.ok(not has_function_privilege('anon', 'public.codev_claim_jobs(text,integer,integer)', 'EXECUTE'), 'claim RPC not public');
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relname in ('automations','jobs','reports','report_versions','agenda_items','incidents','site_checks','metric_snapshots','news_items') and relnamespace = 'public'::regnamespace), 'RLS enabled');

select 'CORE_CHECKS=' || passed from pg_temp.core_checks;
rollback;
