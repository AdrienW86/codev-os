-- Synthetic PostgreSQL local test only (Lot 4.3 P11-b). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (P9 state, switches open for the engine), P10, P11-a and P11-b.
create function pg_temp.pb_due(p_delivery uuid) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=p_delivery and type='deliver' and status='pending';set local role service_role;end $$;
-- Prepared, claimed and dispatched delivery whose provider answer was lost: uncertain.
create function pg_temp.pb_uncertain(p_platform text,p_text text) returns uuid language plpgsql as $$
declare pub uuid;d uuid;c jsonb;begin
 pub:=pg_temp.p10_publication(p_platform,p_text);set local role service_role;
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;perform pg_temp.pb_due(d);
 c:=public.publication_job_claim('worker-pb',60);perform public.publication_job_dispatch((c->>'job_id')::uuid,'worker-pb',1);
 perform public.publication_job_complete((c->>'job_id')::uuid,'worker-pb',1,'{"result":"uncertain","error_code":"timeout_after_dispatch","duration_ms":20000}');
 reset role;return d;
end $$;
grant execute on function pg_temp.pb_due(uuid),pg_temp.pb_uncertain(text,text) to service_role;

-- 1. Grants and properties.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_delivery_reconcile_context(uuid)','public.publication_delivery_reconcile(uuid,text,text,text)','public.publication_delivery_confirm_not_published(uuid,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_delivery_reconcile(null,''exists'',''1'',''user_x'')','42501','anon refused');
reset role;

-- 2. Context of an uncertain delivery: text, account, dispatch time; never a credential.
do $$declare d uuid:=pg_temp.pb_uncertain('facebook','Texte réconcilié');ctx jsonb;begin
 insert into p10_ids values('pb_fb',d);
 set local role service_role;
 ctx:=public.publication_delivery_reconcile_context(d);
 perform pg_temp.replay_assert(ctx->>'platform'='facebook' and ctx->>'text'='Texte réconcilié' and ctx->'account'->>'external_account_id'='page-10' and ctx->>'since' is not null
  and ctx->>'connection_id'=(select id from p10_ids where name='meta')::text,'context: text, account, dispatch time, connection');
 perform pg_temp.replay_assert(ctx::text !~ '(vault:|token|secret|credential)','context without credential');
 reset role;
end $$;

-- 3. missing → audited, stays uncertain; explicit decision → failed → manual retry possible. exists → published.
set local role service_role;
do $$declare d uuid:=(select id from p10_ids where name='pb_fb');r jsonb;d2 uuid;begin
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published(%L,''user_local'')',d),'55000','no decision before a provider check');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',null,''user_local'')',d),'22023','exists requires a provider id');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''simulated-abc'',''user_local'')',d),'22023','a simulated id is never a provider id');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''missing'',''123'',''user_local'')',d),'22023','missing carries no id');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''published'',null,''user_local'')',d),'22023','unknown result');
 r:=public.publication_delivery_reconcile(d,'missing',null,'user_local');
 perform pg_temp.replay_assert(r->>'status'='uncertain' and (select status='uncertain' from public.publication_deliveries where id=d),'missing: stays uncertain (no automatic resend)');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.delivery_reconciled' and metadata->>'delivery_id'=d::text and metadata->>'result'='missing'),'check audited');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','still no retry while uncertain');
 r:=public.publication_delivery_confirm_not_published(d,'user_local');
 perform pg_temp.replay_assert(r->>'status'='failed' and (select status='failed' and last_error_code='confirmed_not_published' from public.publication_deliveries where id=d),'explicit decision: failed');
 perform public.publication_delivery_retry(d,'user_local');
 perform pg_temp.replay_assert((select status='scheduled' from public.publication_deliveries where id=d),'manual retry possible after the decision');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_context(%L)',d),'55000','no reconciliation outside uncertain');
 reset role;d2:=pg_temp.pb_uncertain('instagram','Légende retrouvée');set local role service_role;
 r:=public.publication_delivery_reconcile(d2,'exists','17890000000000001','user_local');
 perform pg_temp.replay_assert(r->>'status'='published' and (select status='published' and remote_id='17890000000000001' and published_at is not null and last_error_class is null from public.publication_deliveries where id=d2),'found: published with the provider id');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile(%L,''exists'',''17890000000000001'',''user_local'')',d2),'55000','published is final');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=(select publication_id from public.publication_deliveries where id=d2)),'publication stays approved');
end $$;
reset role;
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action in('publication.delivery_reconciled','publication.delivery_confirmed_not_published')
 and metadata::text ~* '(vault:|token|secret|https?:)'),'reconciliation audit without secret or URL');
