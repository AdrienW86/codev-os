-- Contrôles SQL de l'agent SEO V2 (opportunités de mots-clés) : base locale isolée uniquement, transaction annulée.
begin;
create temporary table seo_checks(passed integer not null);
insert into seo_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'SEO check failed: %', label; end if;
  update pg_temp.seo_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'SEO check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id, name) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'Client SEO');

-- Analyses : une seule planifiée par client, profondeur et jour ; un échec permet de réessayer ; manuelles libres.
insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date, status, error_kind, finished_at) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'daily', 'schedule', '2026-10-12', 'failed', 'rate_limited', now());
insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'daily', 'schedule', '2026-10-12');
select pg_temp.fails($$insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'daily', 'schedule', '2026-10-12')$$, '23505', 'scheduled analysis once per day');
insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'weekly', 'manual', '2026-10-12');
insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'weekly', 'manual', '2026-10-12');
select pg_temp.fails($$insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date, status) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'daily', 'manual', '2026-10-12', 'succeeded')$$, '23514', 'finished analysis has an end date');
select pg_temp.fails($$insert into public.seo_opportunity_analyses(client_id, depth, trigger, analysis_date, status, error_kind, finished_at) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'daily', 'manual', '2026-10-12', 'failed', 'Token ya29 leaked', now())$$, '23514', 'error kind only');

-- Opportunités : donnée Search Console vérifiée avec métriques ; hypothèse sans aucune métrique.
insert into public.seo_keyword_opportunities(id, client_id, fingerprint, category, keyword, target_url, target_status, intent, priority, confidence, data_source, verified, metrics, rationale, recommended_action, action_kind)
values ('bbbbbbbb-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-0000000000c1', 'query:devis plombier', 'striking_distance', 'devis plombier', '/plomberie', 'existing', 'transactional', 'high', 'medium', 'search_console', true, '{"clicks":4,"impressions":300,"ctr":0.013,"position":6.2}', 'Position 6,2 sur 300 impressions.', 'Renforcer la page.', 'optimize_page');
select pg_temp.fails($$insert into public.seo_keyword_opportunities(client_id, fingerprint, category, keyword, target_status, intent, priority, confidence, data_source, verified, metrics, rationale, recommended_action, action_kind) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'query:devis plombier', 'low_ctr', 'devis plombier', 'existing', 'commercial', 'low', 'low', 'search_console', true, '{"clicks":1,"impressions":10}', 'x', 'y', 'improve_snippet')$$, '23505', 'one opportunity per client and fingerprint');
select pg_temp.fails($$insert into public.seo_keyword_opportunities(client_id, fingerprint, category, keyword, target_status, intent, priority, confidence, data_source, verified, metrics, rationale, recommended_action, action_kind) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'gap:chauffage', 'content_gap', 'chauffage', 'missing', 'commercial', 'low', 'low', 'business_context', false, '{"clicks":0,"impressions":900}', 'x', 'y', 'create_page')$$, '23514', 'hypothesis carries no Google metric');
select pg_temp.fails($$insert into public.seo_keyword_opportunities(client_id, fingerprint, category, keyword, target_status, intent, priority, confidence, data_source, verified, rationale, recommended_action, action_kind) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'gap:chaudiere', 'content_gap', 'chaudiere', 'missing', 'commercial', 'low', 'low', 'business_context', true, 'x', 'y', 'create_page')$$, '23514', 'hypothesis never marked verified');
select pg_temp.fails($$insert into public.seo_keyword_opportunities(client_id, fingerprint, category, keyword, target_status, intent, priority, confidence, data_source, verified, rationale, recommended_action, action_kind) values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'query:fuite', 'low_ctr', 'fuite', 'existing', 'commercial', 'low', 'low', 'search_console', true, 'x', 'y', 'improve_snippet')$$, '23514', 'Search Console data carries metrics');
insert into public.seo_keyword_opportunities(client_id, fingerprint, category, keyword, target_status, intent, priority, confidence, data_source, verified, rationale, recommended_action, action_kind)
values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'gap:chauffe-eau', 'content_gap', 'chauffe-eau', 'missing', 'commercial', 'low', 'low', 'business_context', false, 'Service déclaré sans requête associée.', 'Vérifier la demande.', 'investigate');

-- Cycle de vie.
select pg_temp.fails($$update public.seo_keyword_opportunities set status = 'done' where id = 'bbbbbbbb-0000-4000-8000-00000000a001'$$, '23514', 'detected cannot jump to done');
select pg_temp.fails($$update public.seo_keyword_opportunities set status = 'dismissed' where id = 'bbbbbbbb-0000-4000-8000-00000000a001'$$, '23514', 'dismissal requires a reason');
update public.seo_keyword_opportunities set status = 'to_review' where id = 'bbbbbbbb-0000-4000-8000-00000000a001';
update public.seo_keyword_opportunities set status = 'approved' where id = 'bbbbbbbb-0000-4000-8000-00000000a001';
update public.seo_keyword_opportunities set status = 'in_progress' where id = 'bbbbbbbb-0000-4000-8000-00000000a001';
select pg_temp.fails($$update public.seo_keyword_opportunities set status = 'to_review' where id = 'bbbbbbbb-0000-4000-8000-00000000a001'$$, '23514', 'in progress cannot go back to review');
update public.seo_keyword_opportunities set status = 'done' where id = 'bbbbbbbb-0000-4000-8000-00000000a001';
update public.seo_keyword_opportunities set status = 'to_review', status_reason = 'Changement significatif' where id = 'bbbbbbbb-0000-4000-8000-00000000a001';
select pg_temp.ok((select status = 'to_review' from public.seo_keyword_opportunities where id = 'bbbbbbbb-0000-4000-8000-00000000a001'), 'closed opportunity can be reopened');
select pg_temp.fails($$update public.seo_keyword_opportunities set fingerprint = 'query:autre' where id = 'bbbbbbbb-0000-4000-8000-00000000a001'$$, '55000', 'identity immutable');

-- Interventions : référence figée, déploiement et PR enregistrés une seule fois.
insert into public.seo_opportunity_interventions(id, opportunity_id, client_id, keyword, baseline, created_by) values ('bbbbbbbb-0000-4000-8000-00000000b001', 'bbbbbbbb-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-0000000000c1', 'devis plombier', '{"clicks":4,"impressions":300}', 'user_admin');
select pg_temp.fails($$insert into public.seo_opportunity_interventions(opportunity_id, client_id, keyword, created_by, pull_request_url) values ('bbbbbbbb-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-0000000000c1', 'x', 'user_admin', 'https://evil.example/pull/1')$$, '23514', 'GitHub pull request URL only');
update public.seo_opportunity_interventions set pull_request_url = 'https://github.com/acme/site/pull/12', deployed_at = '2026-10-01' where id = 'bbbbbbbb-0000-4000-8000-00000000b001';
select pg_temp.fails($$update public.seo_opportunity_interventions set baseline = '{"clicks":40}' where id = 'bbbbbbbb-0000-4000-8000-00000000b001'$$, '55000', 'baseline immutable');
select pg_temp.fails($$update public.seo_opportunity_interventions set deployed_at = '2026-10-02' where id = 'bbbbbbbb-0000-4000-8000-00000000b001'$$, '55000', 'deployment date set once');
update public.seo_opportunity_interventions set measurements = '{"7":{"verdict":"stable"}}', measured_at = now() where id = 'bbbbbbbb-0000-4000-8000-00000000b001';
select pg_temp.ok((select measurements ? '7' from public.seo_opportunity_interventions where id = 'bbbbbbbb-0000-4000-8000-00000000b001'), 'measurements updatable');

-- Accès : RLS, aucun droit public, pas de suppression par le rôle service.
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('seo_opportunity_analyses','seo_keyword_opportunities','seo_opportunity_interventions')), 'RLS enabled');
select pg_temp.ok(not exists(select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')
  and table_name in ('seo_opportunity_analyses','seo_keyword_opportunities','seo_opportunity_interventions')), 'no public grants');
select pg_temp.ok(not has_table_privilege('service_role', 'public.seo_keyword_opportunities', 'DELETE'), 'history never deleted by the service role');

select 'SEO_OPPORTUNITY_CHECKS=' || passed from pg_temp.seo_checks;
rollback;
