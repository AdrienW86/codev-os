-- Synthetic PostgreSQL local test only (Lot 4.3 P10). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (P9 state) and the P10 migration. No provider is called:
-- the worker is played by SQL calls, the publisher outcome is given explicitly.
create function pg_temp.p10_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
-- Makes the live deliver job of a delivery due now (the test clock; a real worker simply waits).
create function pg_temp.p10_due(p_delivery uuid) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=p_delivery and type='deliver' and status='pending';set local role service_role;end $$;
create function pg_temp.p10_ok(p_result text,p_remote text default null,p_extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('result',p_result,'remote_id',p_remote,'duration_ms',42))||p_extra $$;
grant execute on function pg_temp.p10_error(text),pg_temp.p10_due(uuid),pg_temp.p10_ok(text,text,jsonb) to service_role;

-- 1. Grants, function properties, RLS, browser denial.
do $$declare r text;f text;t text;begin
 foreach f in array array['public.publication_prepare_delivery(uuid,text)','public.publication_job_claim(text,integer)','public.publication_job_context(uuid,text,integer)',
  'public.publication_job_dispatch(uuid,text,integer)','public.publication_job_complete(uuid,text,integer,jsonb)','public.publication_delivery_retry(uuid,text)',
  'public.publication_delivery_cancel(uuid,text)','public.publication_archive(uuid,text)','publications_private.delivery_readiness(uuid)','publications_private.block_delivery(uuid,text)',
  'publications_private.held_job(uuid,text,integer)','publications_private.delivery_retry_delay(integer)','publications_private.guard_delivery_transition()','publications_private.guard_job_transition()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 foreach t in array array['public.publication_deliveries','public.publication_jobs','public.publication_attempts'] loop
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS '||t);
  perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename=split_part(t,'.',2)),'no policy '||t);
  foreach r in array array['anon','authenticated'] loop perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser privileges absent '||t||' '||r);end loop;
  perform pg_temp.replay_assert(not has_table_privilege('service_role',t,'DELETE') and not has_table_privilege('service_role',t,'TRUNCATE'),'server never deletes '||t);
  perform pg_temp.replay_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name=split_part(t,'.',2) and column_name ~* '(token|secret|credential|payload)'),'no secret column '||t);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_job_claim(''w'',60)','42501','anon claim denied');
set local role authenticated;
select pg_temp.replay_failure('select * from public.publication_deliveries','42501','authenticated read denied');
reset role;

-- 2. Additive and legacy-compatible.
select pg_temp.replay_assert((select v->'deliveries' from p10_before)=(select coalesce(jsonb_agg(to_jsonb(d)-'revision_id'-'project_channel_id'-'text_hash'-'asset_ids'-'blocked_reason'-'last_error_class'-'last_error_code' order by d.id),'[]') from public.publication_deliveries d),'legacy delivery unchanged');
select pg_temp.replay_assert((select (v->>'jobs')::bigint=(select count(*) from public.publication_jobs) and (v->>'events')::bigint=(select count(*) from public.publication_events)
 and (v->'publications')=(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p) from p10_before),'no job, event or publication change by the migration');
select pg_temp.replay_assert(publications_private.delivery_retry_delay(1)='1 minute' and publications_private.delivery_retry_delay(2)='5 minutes' and publications_private.delivery_retry_delay(3)='15 minutes'
 and publications_private.delivery_retry_delay(4)='1 hour' and publications_private.delivery_retry_delay(5)='6 hours' and publications_private.delivery_retry_delay(9)='6 hours','deterministic retry schedule');

-- 3. Prepare: refusals, idempotence, immutable snapshot.
set local role service_role;
do $$declare s uuid:=(select id from p10_ids where name='social');cl uuid:=(select id from p10_ids where name='client');draft uuid;pub uuid;r jsonb;r2 jsonb;d public.publication_deliveries;j public.publication_jobs;begin
 draft:=pg_temp.p10_publication('facebook','Brouillon non validé',false);
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',draft))='55000:Publication not approved','draft refused');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''admin'')',draft),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''user_local'')',gen_random_uuid()),'23514','unknown publication');
 pub:=pg_temp.p10_publication('facebook','Texte Facebook P10');insert into p10_ids values('fb_pub',pub);
 -- Kill switches and P9 publishability, checked at preparation.
 reset role;update public.publication_settings set publishing_enabled=false,emergency_stop=true;set local role service_role;
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: emergency_stop','emergency stop');
 reset role;update public.publication_settings set emergency_stop=false;set local role service_role;
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: publishing_disabled','publishing disabled globally');
 reset role;update public.publication_settings set publishing_enabled=true;update public.publication_client_settings set publishing_enabled=false where client_id=cl;set local role service_role;
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: publishing_disabled','publishing disabled for the client');
 reset role;update public.publication_client_settings set publishing_enabled=true where client_id=cl;set local role service_role;
 perform public.publication_channel_save(s,'facebook',false,(select id from p10_ids where name='fb_account'),null,'user_local');
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: channel_disabled','channel disabled');
 perform public.publication_channel_save(s,'facebook',true,(select id from p10_ids where name='fb_account'),null,'user_local');
 perform public.publication_channel_assign_account(s,'facebook',null,'user_local');
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: no_account','no account');
 perform public.publication_channel_assign_account(s,'facebook',(select id from p10_ids where name='fb_account'),'user_local');
 perform public.publication_connection_set_status((select id from p10_ids where name='meta'),'expired',null,null,'user_local');
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Not publishable: connection_inactive','inactive connection');
 perform public.publication_connection_set_status((select id from p10_ids where name='meta'),'active','vault:connection/'||gen_random_uuid()::text,null,'user_local');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where publication_id=pub),'refusals created nothing');
 perform pg_temp.replay_assert(pg_get_functiondef('public.publication_prepare_delivery(uuid,text)'::regprocedure) like '%Media required before delivery%','media re-checked at preparation (approval invariant P8 first)');
 r:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert(r->>'created'='true','delivery prepared');
 select * into d from public.publication_deliveries where id=(r->>'delivery_id')::uuid;select * into j from public.publication_jobs where id=(r->>'job_id')::uuid;
 insert into p10_ids values('fb_delivery',d.id),('fb_job',j.id);
 perform pg_temp.replay_assert(d.status='scheduled' and d.platform='facebook' and d.publication_account_id=(select id from p10_ids where name='fb_account')
  and d.project_channel_id=(select id from p10_ids where name='fb') and d.revision_id=(select current_revision_id from public.publications where id=pub)
  and d.variant_id=(select id from public.publication_variants where revision_id=d.revision_id) and d.text_hash=encode(sha256(convert_to('Texte Facebook P10','UTF8')),'hex')
  and d.asset_ids=(select array_agg(asset_id) from public.publication_variant_assets where variant_id=d.variant_id)
  and d.scheduled_for=(select o.scheduled_for from public.publication_channel_occurrences o join public.publications p on p.occurrence_id=o.id where p.id=pub)
  and d.idempotency_key='deliver:'||d.variant_id::text||':'||d.publication_account_id::text,'immutable snapshot: revision, variant, account, channel, text hash, assets, occurrence time');
 perform pg_temp.replay_assert(j.type='deliver' and j.status='pending' and j.run_at=d.scheduled_for and j.max_attempts=5 and j.attempts=0 and j.deduplication_key='deliver:'||d.id::text||':1','deliver job queued for the occurrence time');
 r2:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert(r2->>'created'='false' and r2->>'delivery_id'=d.id::text and (select count(*) from public.publication_deliveries where publication_id=pub)=1
  and (select count(*) from public.publication_jobs where delivery_id=d.id)=1,'double call: same delivery, same job');
 perform pg_temp.replay_assert((select metadata ?& array['delivery_id','job_id','platform','account_id','revision_id'] from public.publication_events where action='publication.delivery_prepared' and resource_id=pub),'preparation audited');
end $$;
reset role;
do $$declare d uuid:=(select id from p10_ids where name='fb_delivery');begin
 perform pg_temp.replay_failure(format('update public.publication_deliveries set text_hash=repeat(''0'',64) where id=%L',d),'55000','snapshot immutable');
 perform pg_temp.replay_failure(format('update public.publication_deliveries set asset_ids=''{}'' where id=%L',d),'55000','asset snapshot immutable');
 perform pg_temp.replay_failure(format('update public.publication_deliveries set status=''published'',remote_id=''x'' where id=%L',d),'55000','illegal transition scheduled → published');
 perform pg_temp.replay_failure(format('delete from public.publication_deliveries where id=%L',d),'55000','delivery never deleted');
 perform pg_temp.replay_failure(format('delete from public.publication_jobs where delivery_id=%L',d),'55000','job never deleted');
 perform pg_temp.replay_failure(format('insert into public.publication_jobs(type,publication_id,delivery_id,deduplication_key) values(''deliver'',(select publication_id from public.publication_deliveries where id=%L),%L,''dup'')',d,d),'23505','one live job per delivery');
end $$;

-- 4. Claim, lease, reclaim before dispatch, context (TOCTOU), dispatch, simulated success.
set local role service_role;
do $$declare d uuid:=(select id from p10_ids where name='fb_delivery');job uuid:=(select id from p10_ids where name='fb_job');c jsonb;ctx jsonb;r jsonb;a public.publication_attempts;begin
 perform pg_temp.replay_failure('select public.publication_job_claim(''bad worker!'',60)','22023','invalid worker id');
 perform pg_temp.replay_failure('select public.publication_job_claim(''w1'',5)','22023','lease below bound');
 perform pg_temp.replay_failure('select public.publication_job_claim(''w1'',3600)','22023','lease above bound');
 perform pg_temp.replay_assert(public.publication_job_claim('w1',60) is null,'future job not claimed before its time');
 perform pg_temp.p10_due(d);
 reset role;update public.publication_settings set publishing_enabled=false,emergency_stop=true;set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim('w1',60) is null and (select status='pending' from public.publication_jobs where id=job),'no claim under the emergency stop (job untouched)');
 reset role;update public.publication_settings set emergency_stop=false,publishing_enabled=true;set local role service_role;
 c:=public.publication_job_claim('w1',60);
 perform pg_temp.replay_assert((select array_agg(k order by k) from jsonb_object_keys(c) k)=array['attempt','delivery_id','job_id','lease_expires_at','platform'] and c->>'job_id'=job::text and (c->>'attempt')::int=1,'minimal claim payload');
 perform pg_temp.replay_assert((select status='processing' and locked_by='w1' and lease_expires_at>now() and attempts=1 and dispatched_at is null from public.publication_jobs where id=job)
  and (select status='processing' from public.publication_deliveries where id=d),'claimed and leased');
 perform pg_temp.replay_assert(public.publication_job_claim('w2',60) is null,'a claimed job is not claimed twice');
 -- Worker 1 dies before dispatching: after its lease the job is reclaimed (attempt 2), worker 1 is stale.
 reset role;update public.publication_jobs set lease_expires_at=now()-interval '1 second' where id=job;set local role service_role;
 c:=public.publication_job_claim('w2',60);
 perform pg_temp.replay_assert(c->>'job_id'=job::text and (c->>'attempt')::int=2,'expired lease without dispatch: reclaimed');
 perform pg_temp.replay_failure(format('select public.publication_job_context(%L,''w1'',1)',job),'40001','stale worker refused');
 perform pg_temp.replay_failure(format('select public.publication_job_context(%L,''w2'',1)',job),'40001','stale attempt refused');
 ctx:=public.publication_job_context(job,'w2',2);
 perform pg_temp.replay_assert(ctx->>'status'='ready' and ctx->>'text'='Texte Facebook P10' and ctx->'account'->>'external_account_id'='page-10' and jsonb_array_length(ctx->'assets')=1
  and ctx->'assets'->0->>'storage_path' like (select client_id::text from public.publication_deliveries where id=d)||'/%' and ctx->>'connection_id'=(select id from p10_ids where name='meta')::text,'execution context');
 perform pg_temp.replay_assert(ctx::text !~ '(vault:|credential|token|secret)','context without any credential');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('simulated','simulated-x')),'55000','no completion before dispatch');
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'w2',2),'dispatched');
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''w2'',2)',job),'55000','dispatched once');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('simulated','simulated-x',jsonb_build_object('access_token','EAAB'))),'22023','unexpected outcome key refused');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('simulated')),'22023','success without remote id refused');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('permanent',null,'{"error_code":"Invalid OAuth token EAAB"}')),'22023','raw provider text refused as code');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('published','simulated-x')),'23514','a simulated id can never be recorded as a real publication');
 r:=public.publication_job_complete(job,'w2',2,pg_temp.p10_ok('simulated','simulated-fb-1'));
 perform pg_temp.replay_assert(r->>'delivery_status'='simulated' and r->>'job_status'='succeeded','simulated success');
 perform pg_temp.replay_assert((select status='simulated' and remote_id='simulated-fb-1' and published_at is null from public.publication_deliveries where id=d)
  and (select status='succeeded' and locked_by is null and lease_expires_at is null from public.publication_jobs where id=job)
  and (select status='approved' from public.publications where id=(select id from p10_ids where name='fb_pub')),'delivery simulated, never published; publication stays approved');
 select * into a from public.publication_attempts where job_id=job;
 perform pg_temp.replay_assert(a.attempt_number=2 and a.result='succeeded' and a.simulated and a.duration_ms=42 and a.started_at is not null and a.error_class is null and (select count(*) from public.publication_attempts where job_id=job)=1,'one attempt recorded');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w2'',2,%L)',job,pg_temp.p10_ok('simulated','simulated-fb-1')),'40001','duplicate completion refused');
 perform pg_temp.replay_assert(public.publication_prepare_delivery((select id from p10_ids where name='fb_pub'),'user_local')->>'created'='false','prepared again after success: same delivery, nothing re-sent');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','a simulated delivery is final');
 perform pg_temp.replay_failure(format('select public.publication_delivery_cancel(%L,''user_local'')',d),'55000','a final delivery cannot be cancelled');
end $$;
reset role;
select pg_temp.replay_failure(format('update public.publication_attempts set result=''failed'' where job_id=%L',(select id from p10_ids where name='fb_job')),'55000','attempts append-only');
select pg_temp.replay_failure(format('delete from public.publication_attempts where job_id=%L',(select id from p10_ids where name='fb_job')),'55000','attempts never deleted');
select pg_temp.replay_failure(format('update public.publication_deliveries set status=''blocked'' where id=%L',(select id from p10_ids where name='fb_delivery')),'55000','simulated is final');
select pg_temp.replay_failure(format('update public.publication_jobs set status=''pending'' where id=%L',(select id from p10_ids where name='fb_job')),'55000','succeeded job is final');

-- 5. Retryable failures, rate limit, deterministic backoff, max attempts, manual retry without duplicate.
set local role service_role;
do $$declare pub uuid;d uuid;job uuid;c jsonb;r jsonb;n integer;wait interval;begin
 pub:=pg_temp.p10_publication('instagram','Texte Instagram P10');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;insert into p10_ids values('ig_delivery',d);
 for n in 1..5 loop
  perform pg_temp.p10_due(d);c:=public.publication_job_claim('w1',60);job:=(c->>'job_id')::uuid;
  perform pg_temp.replay_assert((c->>'attempt')::int=n,'attempt '||n);
  perform public.publication_job_context(job,'w1',n);perform public.publication_job_dispatch(job,'w1',n);
  r:=public.publication_job_complete(job,'w1',n,case n when 2 then pg_temp.p10_ok('rate_limit',null,'{"error_code":"rate_limited","retry_after_seconds":7200}')
   when 3 then pg_temp.p10_ok('provider_unavailable',null,'{"error_code":"http_503"}') else pg_temp.p10_ok('retryable',null,'{"error_code":"timeout"}') end);
  if n<5 then
   wait:=(r->>'next_attempt_at')::timestamptz-now();
   perform pg_temp.replay_assert(r->>'delivery_status'='retryable_error' and r->>'job_status'='pending'
    and (select status='retryable_error' and last_error_class is not null from public.publication_deliveries where id=d)
    and (select dispatched_at is null and locked_by is null and run_at>now() from public.publication_jobs where id=job),'retry scheduled after attempt '||n);
   perform pg_temp.replay_assert(case n when 1 then wait between interval '59 seconds' and interval '61 seconds' when 2 then wait between interval '7199 seconds' and interval '7201 seconds'
    when 3 then wait between interval '899 seconds' and interval '901 seconds' else wait between interval '3599 seconds' and interval '3601 seconds' end,'backoff after attempt '||n);
   perform pg_temp.replay_assert(public.publication_job_claim('w1',60) is null,'not claimed before its retry time ('||n||')');
  else
   perform pg_temp.replay_assert(r->>'delivery_status'='failed' and r->>'job_status'='failed','max attempts: failed for good');
  end if;
 end loop;
 perform pg_temp.replay_assert((select count(*) from public.publication_attempts where delivery_id=d)=5 and (select string_agg(error_class,',' order by attempt_number) from public.publication_attempts where delivery_id=d)
  ='retryable,rate_limit,provider_unavailable,retryable,retryable' and (select bool_and(error_code ~ '^[a-z0-9_.-]+$') from public.publication_attempts where delivery_id=d),'normalized classes and safe codes only');
 r:=public.publication_delivery_retry(d,'user_local');
 perform pg_temp.replay_assert((select status='scheduled' from public.publication_deliveries where id=d) and (select count(*) from public.publication_jobs where delivery_id=d)=2
  and (select deduplication_key='deliver:'||d::text||':2' and status='pending' and attempts=0 from public.publication_jobs where id=(r->>'job_id')::uuid),'manual retry: same delivery, new job');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','scheduled delivery is not retried again');
 perform pg_temp.replay_assert((select count(*) from public.publication_jobs where delivery_id=d)=2,'no duplicate job');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.delivery_retried' and metadata->>'delivery_id'=d::text),'retry audited');
 perform pg_temp.replay_assert(public.publication_delivery_cancel(d,'user_local')->>'status'='cancelled','scheduled delivery cancelled');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_jobs where delivery_id=d and status in('pending','processing')),'its job cancelled too');
end $$;
reset role;

-- 6. Auth → blocked; permanent / invalid payload → failed; cancel (final, history kept).
set local role service_role;
do $$declare pub uuid;d uuid;job uuid;c jsonb;r jsonb;begin
 pub:=pg_temp.p10_publication('google_business_profile','Texte GBP P10');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;insert into p10_ids values('gbp_delivery',d);
 perform pg_temp.p10_due(d);c:=public.publication_job_claim('w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_dispatch(job,'w1',1);
 r:=public.publication_job_complete(job,'w1',1,pg_temp.p10_ok('auth',null,'{"error_code":"oauth_revoked"}'));
 perform pg_temp.replay_assert(r->>'delivery_status'='blocked' and (select blocked_reason='auth' and last_error_class='auth' from public.publication_deliveries where id=d)
  and (select status='failed' from public.publication_jobs where id=job),'auth error: delivery blocked, no retry');
 perform pg_temp.replay_assert((select status='active' from public.client_connections where id=(select id from p10_ids where name='gbp_connection')),'connection status left to P9 (no implicit mutation)');
 perform public.publication_delivery_retry(d,'user_local');perform pg_temp.p10_due(d);c:=public.publication_job_claim('w1',60);job:=(c->>'job_id')::uuid;
 perform public.publication_job_dispatch(job,'w1',1);r:=public.publication_job_complete(job,'w1',1,pg_temp.p10_ok('invalid_payload',null,'{"error_code":"text_too_long"}'));
 perform pg_temp.replay_assert(r->>'delivery_status'='failed' and r->>'job_status'='failed','invalid payload: failed, no automatic retry');
 r:=public.publication_delivery_cancel(d,'user_local');
 perform pg_temp.replay_assert(r->>'status'='cancelled' and (select status='cancelled' from public.publication_deliveries where id=d),'cancelled');
 perform pg_temp.replay_assert(public.publication_delivery_cancel(d,'user_local')->>'already'='true','cancel idempotent');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','cancelled is final');
 perform pg_temp.replay_assert((select count(*) from public.publication_attempts where delivery_id=d)=2,'history kept');
end $$;

-- 7. Lease lost AFTER dispatch: never sent twice, delivery uncertain (reconcile later).
do $$declare pub uuid;d uuid;job uuid;c jsonb;begin
 pub:=pg_temp.p10_publication('facebook','Deuxième texte Facebook');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.p10_due(d);c:=public.publication_job_claim('w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_dispatch(job,'w1',1);
 reset role;update public.publication_jobs set lease_expires_at=now()-interval '1 second' where id=job;set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim('w2',60) is null,'not reclaimed');
 perform pg_temp.replay_assert((select status='uncertain' and last_error_code='lease_expired_after_dispatch' from public.publication_deliveries where id=d)
  and (select status='failed' from public.publication_jobs where id=job)
  and (select result='uncertain' and attempt_number=1 from public.publication_attempts where job_id=job),'uncertain, attempt recorded, no second send');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''w1'',1,%L)',job,pg_temp.p10_ok('simulated','simulated-late')),'40001','late completion of the lost lease refused');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','uncertain is never retried blindly');
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''user_local'')',pub),'55000','archive waits for reconciliation');
end $$;

-- 8. Blocked at claim time (TOCTOU): disabled channel, then unblocked by a manual retry.
do $$declare s uuid:=(select id from p10_ids where name='social');pub uuid;d uuid;c jsonb;job uuid;begin
 pub:=pg_temp.p10_publication('facebook','Troisième texte Facebook');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;insert into p10_ids values('fb3_pub',pub),('fb3_delivery',d);
 perform pg_temp.p10_due(d);
 perform public.publication_channel_save(s,'facebook',false,(select id from p10_ids where name='fb_account'),null,'user_local');
 perform pg_temp.replay_assert(public.publication_job_claim('w1',60) is null,'nothing to run');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='channel_disabled' from public.publication_deliveries where id=d)
  and not exists(select 1 from public.publication_jobs where delivery_id=d and status in('pending','processing')),'blocked (temporary), job cancelled');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','retry refused while still not publishable');
 perform public.publication_channel_save(s,'facebook',true,(select id from p10_ids where name='fb_account'),null,'user_local');
 perform public.publication_delivery_retry(d,'user_local');perform pg_temp.p10_due(d);c:=public.publication_job_claim('w1',60);job:=(c->>'job_id')::uuid;
 -- Disconnected between claim and execution: the context re-checks and blocks.
 perform public.publication_connection_disconnect((select id from p10_ids where name='client'),(select id from p10_ids where name='meta'),'user_local');
 perform pg_temp.replay_assert(public.publication_job_context(job,'w1',1)=jsonb_build_object('status','blocked','reason','connection_inactive'),'context re-checks: blocked before any provider call');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='connection_inactive' from public.publication_deliveries where id=d),'delivery blocked by the re-check');
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''w1'',1)',job),'40001','no dispatch after the block');
 perform public.publication_connection_register((select id from p10_ids where name='client'),'meta','vault:connection/'||gen_random_uuid()::text,'meta-user-10',null,null,'user_local');
 perform public.publication_accounts_sync((select id from p10_ids where name='client'),(select id from p10_ids where name='meta'),jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-10','display_name','Toitures P10','parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','instagram','external_account_id','ig-10','display_name','@toitures.p10','parent_external_id','page-10','metadata','{}'::jsonb)),'user_local');
end $$;

-- 9. Revision after preparation: the blocked delivery keeps its snapshot; the new approved revision supersedes it.
do $$declare pub uuid:=(select id from p10_ids where name='fb3_pub');old uuid:=(select id from p10_ids where name='fb3_delivery');p public.publications;asset uuid;rev uuid;r jsonb;oldsnap jsonb;begin
 select * into p from public.publications where id=pub;select asset_id into asset from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=p.current_revision_id;
 select to_jsonb(d)-'updated_at'-'status'-'blocked_reason' into oldsnap from public.publication_deliveries d where id=old;
 perform public.publication_save_draft(pub,p.current_revision_id,p.client_id,p.project_id,'P10 révisée','Angle','Source',p.target_date,null,null,
  jsonb_build_array(jsonb_build_object('platform','facebook','text_content','Texte Facebook révisé','asset_ids',jsonb_build_array(asset))),'user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert((select status='blocked' from public.publication_deliveries where id=old),'revision blocks the prepared delivery');
 perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 r:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert(r->>'created'='true' and (select status='cancelled' from public.publication_deliveries where id=old)
  and oldsnap=(select to_jsonb(d)-'updated_at'-'status'-'blocked_reason' from public.publication_deliveries d where id=old),'old delivery superseded (cancelled) with its snapshot intact');
 perform pg_temp.replay_assert((select revision_id=rev and text_hash=encode(sha256(convert_to('Texte Facebook révisé','UTF8')),'hex') from public.publication_deliveries where id=(r->>'delivery_id')::uuid)
  and (select count(*) from public.publication_deliveries where publication_id=pub and status<>'cancelled')=1,'one live delivery on the new revision');
end $$;
reset role;

-- 10. Archive accepts final deliveries; an archived publication is never prepared.
set local role service_role;
do $$declare pub uuid:=(select id from p10_ids where name='fb_pub');begin
 perform public.publication_archive(pub,'user_local');
 perform pg_temp.replay_assert(pg_temp.p10_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Archived publication','archived publication never prepared');
end $$;
reset role;

-- 11. Safety: nothing really published, audit without secret, legacy delivery untouched.
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where status='published'),'no real publication in this lot');
select pg_temp.replay_assert((select status='scheduled' and revision_id is null from public.publication_deliveries where id=(select id from p10_ids where name='legacy_delivery')),'legacy delivery untouched (never claimed)');
-- Meta token prefix matched case-SENSITIVELY: lowercase "eaab" occurs in random UUIDs of the audit metadata.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action like 'publication.delivery_%'
 and ((coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(vault:|token|secret|credential|https?:)'
  or (coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~ 'EAAB')),'delivery audit without secret or provider text');
select pg_temp.replay_assert(not exists(select 1 from public.publication_attempts where coalesce(sanitized_error,'')||coalesce(error_code,'') ~* '(token|secret| )'
 or coalesce(sanitized_error,'')||coalesce(error_code,'') ~ 'EAAB'),'attempts without provider text');
