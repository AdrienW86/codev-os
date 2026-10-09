-- Synthetic PostgreSQL local test only (Lot 4.3 P12). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (P9 state, switches open for the engine), P10, P11-a, P11-b, P12.
create function pg_temp.pg_due(p_delivery uuid) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=p_delivery and type='deliver' and status='pending';set local role service_role;end $$;
create function pg_temp.pg_uncertain(p_platform text,p_text text) returns uuid language plpgsql as $$
declare pub uuid;d uuid;c jsonb;begin
 pub:=pg_temp.p10_publication(p_platform,p_text);set local role service_role;
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;perform pg_temp.pg_due(d);
 c:=public.publication_job_claim('worker-pg',60);perform public.publication_job_dispatch((c->>'job_id')::uuid,'worker-pg',1);
 perform public.publication_job_complete((c->>'job_id')::uuid,'worker-pg',1,'{"result":"uncertain","error_code":"timeout_after_dispatch","duration_ms":20000}');
 reset role;return d;
end $$;
grant execute on function pg_temp.pg_due(uuid),pg_temp.pg_uncertain(text,text) to service_role;

-- 1. Grants and properties unchanged by the replacement.
do $$declare r text;f text:='public.publication_delivery_reconcile(uuid,text,text,text)';begin
 foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||r);end loop;
 perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function');
 perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path');
 perform pg_temp.replay_assert((select count(*)=1 from pg_proc where proname='publication_delivery_reconcile'),'one reconcile function (no overload)');
end $$;
set local role authenticated;
select pg_temp.replay_failure('select public.publication_delivery_reconcile(null,''exists'',''accounts/10/locations/1/localPosts/1'',''user_x'')','42501','authenticated refused');
reset role;

-- 2. A GBP delivery published by the engine keeps the Google post name (P10 contract, no schema change needed).
do $$declare pub uuid;d uuid;c jsonb;r jsonb;begin
 pub:=pg_temp.p10_publication('google_business_profile','Poste GBP publié');set local role service_role;
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;perform pg_temp.pg_due(d);
 c:=public.publication_job_claim('worker-pg',60);
 perform pg_temp.replay_assert(c->>'platform'='google_business_profile','GBP job claimed');
 perform public.publication_job_dispatch((c->>'job_id')::uuid,'worker-pg',1);
 r:=public.publication_job_complete((c->>'job_id')::uuid,'worker-pg',1,'{"result":"published","remote_id":"accounts/10/locations/1/localPosts/abc_123","duration_ms":800}');
 perform pg_temp.replay_assert((select status='published' and remote_id='accounts/10/locations/1/localPosts/abc_123' from public.publication_deliveries where id=d),'engine stores the Google post name');
 reset role;
end $$;

-- 3. Reconciliation of an uncertain GBP delivery: post name of the delivery's own location only.
do $$declare d uuid:=pg_temp.pg_uncertain('google_business_profile','Poste GBP incertain');ctx jsonb;r jsonb;begin
 set local role service_role;
 ctx:=public.publication_delivery_reconcile_context(d);
 perform pg_temp.replay_assert(ctx->>'platform'='google_business_profile' and ctx->'account'->>'external_account_id'='accounts/10/locations/1' and ctx->>'text'='Poste GBP incertain' and ctx->>'since' is not null,'GBP context');
 perform pg_temp.replay_assert(ctx::text !~ '(vault:|token|secret|credential)','context without credential');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''1001_42'',''user_local'')',d),'22023','a Meta id is not a Google post');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/2/localPosts/9'',''user_local'')',d),'22023','post of another location refused');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/1x/localPosts/9'',''user_local'')',d),'22023','prefix of another location refused');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/1/localPosts/../9'',''user_local'')',d),'22023','path traversal refused');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/1'',''user_local'')',d),'22023','a location is not a post');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',null,''user_local'')',d),'22023','exists requires a provider id');
 perform pg_temp.replay_assert((select status='uncertain' from public.publication_deliveries where id=d),'refusals leave it uncertain');
 r:=public.publication_delivery_reconcile(d,'unknown',null,'user_local');
 perform pg_temp.replay_assert(r->>'status'='uncertain','unknown: stays uncertain');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published(%L,''user_local'')',d),'55000','unknown is not missing: no decision');
 r:=public.publication_delivery_reconcile(d,'exists','accounts/10/locations/1/localPosts/xyz-9','user_local');
 perform pg_temp.replay_assert(r->>'status'='published' and (select status='published' and remote_id='accounts/10/locations/1/localPosts/xyz-9' from public.publication_deliveries where id=d),'found: published with the Google post name');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/1/localPosts/xyz-9'',''user_local'')',d),'55000','published is final');
 reset role;
end $$;

-- 4. Meta behaviour unchanged (P11-b format), GBP missing → explicit decision → failed.
do $$declare d uuid:=pg_temp.pg_uncertain('facebook','Texte Meta après P12');g uuid:=pg_temp.pg_uncertain('google_business_profile','Poste GBP absent');r jsonb;begin
 set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''accounts/10/locations/1/localPosts/1'',''user_local'')',d),'22023','a Google name is not a Meta id');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''simulated-abc'',''user_local'')',d),'22023','a simulated id is never a provider id');
 r:=public.publication_delivery_reconcile(d,'exists','1001_99','user_local');
 perform pg_temp.replay_assert(r->>'status'='published','Meta id still accepted');
 perform public.publication_delivery_reconcile(g,'missing',null,'user_local');
 r:=public.publication_delivery_confirm_not_published(g,'user_local');
 perform pg_temp.replay_assert(r->>'status'='failed' and (select status='failed' from public.publication_deliveries where id=g),'GBP missing then decision: failed');
 reset role;
end $$;
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action in('publication.delivery_reconciled','publication.delivery_confirmed_not_published')
 and metadata::text ~* '(vault:|token|secret|https?:)'),'reconciliation audit without secret or URL');
select pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.delivery_reconciled' and metadata->>'platform'='google_business_profile')=3,'GBP reconciliations audited');
