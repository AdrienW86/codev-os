-- Contrôles SQL des rapports Google Ads à périmètre figé (base locale isolée, transaction annulée).
begin;
create temporary table ads_checks(passed integer not null);
insert into ads_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Ads report check failed: %', label; end if;
  update pg_temp.ads_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'Ads report check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id, name) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Client Ads');

-- Rapports récurrents : inchangés (défaut '{}', unicité par période conservée).
insert into public.reports(id, client_id, kind, period_start, period_end) values ('ffffffff-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'weekly', '2026-09-28', '2026-10-04');
select pg_temp.ok((select scope = '{}'::jsonb from public.reports where id = 'ffffffff-0000-4000-8000-0000000000a1'), 'recurring report scope defaults to empty object');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'weekly', '2026-09-28', '2026-10-04')$$, '23505', 'weekly uniqueness kept');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end) values (null, 'monthly', '2026-09-01', '2026-09-30'), (null, 'monthly', '2026-09-01', '2026-09-30')$$, '23505', 'nulls not distinct kept for recurring reports');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'quarterly', '2026-07-01', '2026-09-30')$$, '23514', 'unknown kind rejected');
update public.reports set summary = 'modifié', version=version+1 where id = 'ffffffff-0000-4000-8000-0000000000a1';
select pg_temp.ok((select summary = 'modifié' from public.reports where id = 'ffffffff-0000-4000-8000-0000000000a1'), 'recurring report still editable');

-- Rapport Google Ads : périmètre obligatoire et cohérent avec la période.
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'google_ads', '2026-09-01', '2026-09-30')$$, '23514', 'google_ads requires a scope');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end, scope) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'google_ads', '2026-09-01', '2026-09-30', '{"start":"2026-09-02","end":"2026-09-30","campaignIds":["1"]}')$$, '23514', 'scope dates must match the period');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end, scope) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'google_ads', '2026-09-01', '2026-09-30', '{"start":"2026-09-01","end":"2026-09-30","campaignIds":[]}')$$, '23514', 'scope needs at least one campaign');
select pg_temp.fails($$insert into public.reports(client_id, kind, period_start, period_end, scope) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'weekly', '2026-09-21', '2026-09-27', '[]')$$, '23514', 'scope must be an object');
insert into public.reports(id, client_id, kind, period_start, period_end, status, scope, client_content)
values ('ffffffff-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'google_ads', '2026-09-01', '2026-09-30', 'ready_for_review', '{"start":"2026-09-01","end":"2026-09-30","campaignIds":["111"]}', '{"summary":"v1"}');
-- Plusieurs rapports Google Ads peuvent couvrir la même période (campagnes différentes).
insert into public.reports(client_id, kind, period_start, period_end, scope)
values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'google_ads', '2026-09-01', '2026-09-30', '{"start":"2026-09-01","end":"2026-09-30","campaignIds":["222"]}');
select pg_temp.ok((select count(*) = 2 from public.reports where kind = 'google_ads'), 'several google_ads reports on the same period');

-- Périmètre, période, type et client figés ; contenu et statut suivent le cycle existant.
select pg_temp.fails($$update public.reports set scope = '{"start":"2026-09-01","end":"2026-09-30","campaignIds":["999"]}' where id = 'ffffffff-0000-4000-8000-0000000000a2'$$, '55000', 'scope immutable');
select pg_temp.fails($$update public.reports set period_end = '2026-09-29' where id = 'ffffffff-0000-4000-8000-0000000000a2'$$, '55000', 'period immutable');
select pg_temp.fails($$update public.reports set kind = 'monthly' where id = 'ffffffff-0000-4000-8000-0000000000a2'$$, '55000', 'kind immutable');
select pg_temp.fails($$update public.reports set kind = 'google_ads' where id = 'ffffffff-0000-4000-8000-0000000000a1'$$, '55000', 'recurring report cannot become google_ads');
select pg_temp.fails($$update public.reports set client_id = null where id = 'ffffffff-0000-4000-8000-0000000000a2'$$, '55000', 'client immutable');
update public.reports set status = 'approved', approved_version = version, approved_by = 'admin', approved_at = now() where id = 'ffffffff-0000-4000-8000-0000000000a2';
update public.reports set client_content = '{"summary":"v2"}', version = 2 where id = 'ffffffff-0000-4000-8000-0000000000a2';
select pg_temp.ok((select status = 'ready_for_review' and approved_at is null and scope->'campaignIds' = '["111"]' from public.reports where id = 'ffffffff-0000-4000-8000-0000000000a2'), 'new version invalidates approval and keeps scope');

-- Versions : périmètre facultatif (versions historiques), objet sinon.
select pg_temp.ok(exists(select 1 from public.report_versions where report_id='ffffffff-0000-4000-8000-0000000000a2' and version=1), 'transactional first snapshot');
select pg_temp.fails($$insert into public.report_versions(report_id, version, scope) values ('ffffffff-0000-4000-8000-0000000000a2', 2, '"x"')$$, '23514', 'version scope must be an object');

select pg_temp.ok(not has_function_privilege('anon', 'codev_private.reports_scope_guard()', 'EXECUTE'), 'guard not executable by anon');

select 'ADS_REPORT_CHECKS=' || passed from pg_temp.ads_checks;
rollback;
