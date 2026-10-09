-- Synthetic PostgreSQL local test only (Lot 4.3 Gate 5 — chaos). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (P9 state, switches open) and every migration through P12.
-- Each block replays one failure of the real world against the real RPCs (worker side as service_role, admin side
-- as service_role with an admin actor). Invariant checked everywhere: a delivery is never dispatched twice, an
-- ambiguous provider answer is never retried automatically, and nothing runs while a kill switch is closed.
create function pg_temp.cx_due(p_delivery uuid) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=p_delivery and type='deliver' and status='pending';set local role service_role;end $$;
create function pg_temp.cx_expire(p_job uuid) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set lease_expires_at=now()-interval '1 second' where id=p_job;set local role service_role;end $$;
-- Approved publication prepared and due: returns the delivery.
create function pg_temp.cx_ready(p_platform text,p_text text) returns uuid language plpgsql as $$
declare pub uuid;d uuid;begin
 pub:=pg_temp.p10_publication(p_platform,p_text);set local role service_role;
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;perform pg_temp.cx_due(d);reset role;return d;
end $$;
create function pg_temp.cx_job(p_delivery uuid) returns uuid language sql as $$
 select id from public.publication_jobs where delivery_id=p_delivery and type='deliver' order by created_at desc,id limit 1 $$;
create function pg_temp.cx_dispatches(p_delivery uuid) returns bigint language sql as $$
 select count(*) from public.publication_jobs where delivery_id=p_delivery and type='deliver' and dispatched_at is not null $$;
create function pg_temp.cx_outcome(p_result text,p_remote text default null,p_code text default null,p_retry integer default null) returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('result',p_result,'remote_id',p_remote,'error_code',p_code,'retry_after_seconds',p_retry,'duration_ms',100)) $$;
grant execute on function pg_temp.cx_due(uuid),pg_temp.cx_expire(uuid),pg_temp.cx_ready(text,text),pg_temp.cx_job(uuid),pg_temp.cx_dispatches(uuid),
 pg_temp.cx_outcome(text,text,text,integer) to service_role;
create temporary table cx(name text primary key,id uuid not null);
grant select,insert on cx to service_role;

-- C01 Worker crash BEFORE dispatch: the lease expires, the job is reclaimed (attempt 2); nothing was sent.
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 01');c jsonb;job uuid;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert((public.publication_job_context(job,'cx-w1',1))->>'status'='ready','C01 context ready');
 perform pg_temp.cx_expire(job);
 c:=public.publication_job_claim('cx-w2',60);
 perform pg_temp.replay_assert(c->>'job_id'=job::text and (c->>'attempt')::int=2,'C01 reclaimed after the crash (attempt 2)');
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''cx-w1'',1)',job),'40001','C01 crashed worker can no longer dispatch');
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'cx-w2',2),'C01 new worker dispatches');
 perform public.publication_job_complete(job,'cx-w2',2,pg_temp.cx_outcome('published','1001_101'));
 perform pg_temp.replay_assert((select status='published' from public.publication_deliveries where id=d) and pg_temp.cx_dispatches(d)=1
  and (select count(*)=1 from public.publication_attempts where delivery_id=d),'C01 published once, one attempt');
 reset role;
end $$;

-- C02 Worker crash AFTER dispatch (and C05: database failure after the provider succeeded — the completion never
-- arrives). The lease expires → uncertain; never reclaimed nor retried; the reconciliation finds the post.
do $$declare d uuid:=pg_temp.cx_ready('google_business_profile','Chaos 02 GBP');m uuid:=pg_temp.cx_ready('instagram','Chaos 05 Meta');c jsonb;job uuid;r jsonb;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform pg_temp.cx_expire(job);
 c:=public.publication_job_claim('cx-w2',60);
 perform pg_temp.replay_assert(c is null or (c->>'job_id')<>job::text,'C02 dispatched job never reclaimed');
 perform pg_temp.replay_assert((select status='uncertain' and last_error_code='lease_expired_after_dispatch' from public.publication_deliveries where id=(select delivery_id from public.publication_jobs where id=job)),'C02 uncertain');
 if c is not null then perform public.publication_job_context((c->>'job_id')::uuid,'cx-w2',(c->>'attempt')::int);perform public.publication_job_dispatch((c->>'job_id')::uuid,'cx-w2',(c->>'attempt')::int);
  perform pg_temp.cx_expire((c->>'job_id')::uuid);perform public.publication_job_claim('cx-w3',60); end if;
 perform pg_temp.replay_assert((select status='uncertain' from public.publication_deliveries where id=d) and (select status='uncertain' from public.publication_deliveries where id=m),'C02/C05 both uncertain');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','C02 no blind retry');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''cx-w1'',1,%L)',job,pg_temp.cx_outcome('published','accounts/10/locations/1/localPosts/late')),'40001','C05 late completion refused');
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w4',60) is null,'C02 nothing left to run');
 r:=public.publication_delivery_reconcile(d,'exists','accounts/10/locations/1/localPosts/c02','user_local');
 perform pg_temp.replay_assert((select status='published' and remote_id='accounts/10/locations/1/localPosts/c02' from public.publication_deliveries where id=d),'C02 reconciled: published (GBP name)');
 r:=public.publication_delivery_reconcile(m,'exists','17890000000000502','user_local');
 perform pg_temp.replay_assert((select status='published' and remote_id='17890000000000502' from public.publication_deliveries where id=m),'C05 reconciled: published (Meta id)');
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(d)=1 and pg_temp.cx_dispatches(m)=1,'C02/C05 one dispatch each');
 reset role;
end $$;

-- C03 Provider timeout / C04 lost response after the write: the worker records uncertain; never retried; the
-- reconciliation finds nothing → explicit decision → failed → manual retry creates ONE new job.
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 03');e uuid:=pg_temp.cx_ready('google_business_profile','Chaos 04');c jsonb;job uuid;x uuid;begin
 set local role service_role;
 foreach x in array array[d,e] loop
  c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
  perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('uncertain',null,case when (c->>'delivery_id')::uuid=d then 'timeout_after_dispatch' else 'network_after_dispatch' end));
 end loop;
 perform pg_temp.replay_assert((select bool_and(status='uncertain') from public.publication_deliveries where id in(d,e)),'C03/C04 uncertain');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_jobs where delivery_id in(d,e) and status in('pending','processing')),'C03/C04 no automatic retry job');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published(%L,''user_local'')',d),'55000','C03 no decision without a provider check');
 perform public.publication_delivery_reconcile(d,'missing',null,'user_local');perform public.publication_delivery_confirm_not_published(d,'user_local');
 perform public.publication_delivery_retry(d,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','C03 second retry refused (scheduled)');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_jobs where delivery_id=d and status='pending'),'C03 exactly one new job');
 perform public.publication_delivery_reconcile(e,'unknown',null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published(%L,''user_local'')',e),'55000','C04 unknown is not a proof of absence');
 perform public.publication_delivery_cancel(d,'user_local');
 reset role;
end $$;

-- C06 Expired token / C07 revoked token: auth → delivery blocked, no retry; while the connection is expired the
-- manual retry is refused; after reconnection the retry is possible (same delivery).
do $$declare d uuid:=pg_temp.cx_ready('instagram','Chaos 06');c jsonb;job uuid;cl uuid:=(select id from p10_ids where name='client');meta uuid:=(select id from p10_ids where name='meta');begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('auth',null,'token_expired'));
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='auth' and last_error_code='token_expired' from public.publication_deliveries where id=d),'C06 blocked (auth)');
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w1',60) is null,'C06 nothing claimed after auth');
 perform public.publication_connection_set_status(meta,'revoked',null,null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','C07 revoked connection: retry refused');
 perform public.publication_connection_register(cl,'meta','vault:connection/'||gen_random_uuid()::text,'meta-user-10',null,null,'user_local');
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-10','display_name','Toitures P10','parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','instagram','external_account_id','ig-10','display_name','@toitures.p10','parent_external_id','page-10','metadata','{}'::jsonb)),'user_local');
 perform public.publication_delivery_retry(d,'user_local');
 perform pg_temp.replay_assert((select status='scheduled' from public.publication_deliveries where id=d) and (select count(*)=1 from public.publication_deliveries where publication_id=(select publication_id from public.publication_deliveries where id=d)),'C06/C07 retry after reconnection: same delivery');
 perform public.publication_delivery_cancel(d,'user_local');
 reset role;
end $$;

-- C08 Account disabled / C18 account removed by a sync: blocked before the dispatch (context or dispatch re-check).
do $$declare d uuid:=pg_temp.cx_ready('google_business_profile','Chaos 18');c jsonb;job uuid;cl uuid:=(select id from p10_ids where name='client');gbp uuid:=(select id from p10_ids where name='gbp_connection');ctx jsonb;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(public.publication_job_context(job,'cx-w1',1)->>'status'='ready','C18 ready before the sync');
 perform public.publication_accounts_sync(cl,gbp,'[]'::jsonb,'user_local');
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'cx-w1',1)=false,'C18 location removed by the sync: dispatch refused');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='account_inactive' from public.publication_deliveries where id=d) and pg_temp.cx_dispatches(d)=0,'C18 blocked, never dispatched');
 perform public.publication_accounts_sync(cl,gbp,jsonb_build_array(jsonb_build_object('platform','google_business_profile','external_account_id','accounts/10/locations/1','display_name','Toitures P10 — Lyon','parent_external_id','accounts/10','metadata','{}'::jsonb)),'user_local');
 perform public.publication_delivery_cancel(d,'user_local');
 reset role;
end $$;
-- C08: the Facebook Page is no longer granted (provider side): the sync disables that account only.
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 08');c jsonb;job uuid;cl uuid:=(select id from p10_ids where name='client');meta uuid:=(select id from p10_ids where name='meta');begin
 set local role service_role;c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(
  jsonb_build_object('platform','instagram','external_account_id','ig-10','display_name','@toitures.p10','parent_external_id','page-10','metadata','{}'::jsonb)),'user_local');
 perform pg_temp.replay_assert((select not enabled from public.publication_accounts where id=(select id from p10_ids where name='fb_account'))
  and (select enabled from public.publication_accounts where id=(select id from p10_ids where name='ig_account')),'C08 only the Facebook account disabled');
 perform pg_temp.replay_assert(public.publication_job_context(job,'cx-w1',1)=jsonb_build_object('status','blocked','reason','account_inactive'),'C08 disabled account: context blocks');
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''cx-w1'',1)',job),'40001','C08 no dispatch after the block');
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(d)=0,'C08 never dispatched');
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-10','display_name','Toitures P10','parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','instagram','external_account_id','ig-10','display_name','@toitures.p10','parent_external_id','page-10','metadata','{}'::jsonb)),'user_local');
 perform public.publication_delivery_cancel(d,'user_local');reset role;
end $$;

-- C09 Channel disabled between the claim and the dispatch.
do $$declare d uuid:=pg_temp.cx_ready('google_business_profile','Chaos 09');c jsonb;job uuid;s uuid:=(select id from p10_ids where name='social');begin
 set local role service_role;c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(public.publication_job_context(job,'cx-w1',1)->>'status'='ready','C09 ready');
 perform public.publication_channel_save(s,'google_business_profile',false,(select id from p10_ids where name='gbp_account'),null,'user_local');
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'cx-w1',1)=false,'C09 dispatch refused');
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(d)=0,'C09 not dispatched');
 perform pg_temp.replay_assert((select status='blocked' from public.publication_deliveries where id=d),'C09 blocked '||(select status||'/'||coalesce(blocked_reason,'-') from public.publication_deliveries where id=d));
 perform public.publication_channel_save(s,'google_business_profile',true,(select id from p10_ids where name='gbp_account'),null,'user_local');
 perform public.publication_delivery_cancel(d,'user_local');reset role;
end $$;

-- C10 Emergency stop: nothing claimed while closed; closed between claim and dispatch → no dispatch.
do $$declare a uuid:=pg_temp.cx_ready('facebook','Chaos 10a');b uuid:=pg_temp.cx_ready('google_business_profile','Chaos 10b');c jsonb;job uuid;begin
 update public.publication_settings set emergency_stop=true,publishing_enabled=false;
 set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w1',60) is null and public.publication_job_claim('cx-w2',60) is null,'C10 emergency stop: nothing claimed');
 perform pg_temp.replay_assert((select bool_and(status='pending' and attempts=0) from public.publication_jobs where delivery_id in(a,b) and type='deliver'),'C10 jobs untouched');
 reset role;update public.publication_settings set emergency_stop=false,publishing_enabled=true;set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(public.publication_job_context(job,'cx-w1',1)->>'status'='ready','C10 ready once reopened');
 reset role;update public.publication_settings set emergency_stop=true,publishing_enabled=false;set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'cx-w1',1)=false,'C10 closed just before the dispatch: refused');
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(a)+pg_temp.cx_dispatches(b)=0,'C10 nothing dispatched');
 reset role;update public.publication_settings set emergency_stop=false,publishing_enabled=false;set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w1',60) is null or public.publication_job_context((select id from public.publication_jobs where status='processing' and locked_by='cx-w1' limit 1),'cx-w1',
  (select attempts from public.publication_jobs where status='processing' and locked_by='cx-w1' limit 1))->>'status'='blocked','C10 publishing disabled: nothing runnable');
 reset role;update public.publication_settings set publishing_enabled=true;
 set local role service_role;perform public.publication_delivery_cancel(a,'user_local');perform public.publication_delivery_cancel(b,'user_local');reset role;
end $$;

-- C11 Archived publication: never prepared again; archive waits while a delivery is uncertain.
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 11');pub uuid;c jsonb;job uuid;begin
 select publication_id into pub from public.publication_deliveries where id=d;
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('uncertain',null,'timeout_after_dispatch'));
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''user_local'')',pub),'55000','C11 archive refused while uncertain');
 perform public.publication_delivery_reconcile(d,'exists','1001_111','user_local');
 perform public.publication_archive(pub,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''user_local'')',pub),'55000','C11 archived: never prepared');
 reset role;
end $$;

-- C12 Revision attempted while the job is in flight: refused (an active delivery freezes the publication); the
-- worker sends the snapshot it was given. (Revision of a not-yet-claimed delivery: P10 suite, section 9.)
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 12');pub uuid;p public.publications;c jsonb;job uuid;asset uuid;begin
 select publication_id into pub from public.publication_deliveries where id=d;select * into p from public.publications where id=pub;
 select asset_id into asset from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=p.current_revision_id;
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(public.publication_job_context(job,'cx-w1',1)->>'text'='Chaos 12','C12 snapshot text');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''Chaos 12 révisée'',''Angle'',''Source'',%L,null,null,%L,''user_local'')',
  pub,p.current_revision_id,p.client_id,p.project_id,p.target_date,jsonb_build_array(jsonb_build_object('platform','facebook','text_content','Chaos 12 révisé','asset_ids',jsonb_build_array(asset)))),'55000','C12 revision refused while the delivery is in flight');
 perform pg_temp.replay_assert((select current_revision_id=p.current_revision_id from public.publications where id=pub),'C12 revision unchanged');
 perform pg_temp.replay_assert(public.publication_job_dispatch(job,'cx-w1',1),'C12 dispatch of the approved snapshot');
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('published','1001_112'));
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(d)=1 and (select text_hash=encode(sha256(convert_to('Chaos 12','UTF8')),'hex') from public.publication_deliveries where id=d),'C12 sent once, approved text only');
 reset role;
end $$;

-- C15 Duplicate workers: one claim only; a foreign worker can neither read, dispatch nor complete it.
do $$declare d uuid:=pg_temp.cx_ready('instagram','Chaos 15');c jsonb;job uuid;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w2',60) is null,'C15 second worker gets nothing');
 perform pg_temp.replay_failure(format('select public.publication_job_context(%L,''cx-w2'',1)',job),'40001','C15 foreign context refused');
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''cx-w2'',1)',job),'40001','C15 foreign dispatch refused');
 perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform pg_temp.replay_failure(format('select public.publication_job_dispatch(%L,''cx-w1'',1)',job),'55000','C15 same worker cannot dispatch twice');
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''cx-w2'',1,%L)',job,pg_temp.cx_outcome('published','17890000000000150')),'40001','C15 foreign completion refused');
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('published','17890000000000151'));
 perform pg_temp.replay_failure(format('select public.publication_job_complete(%L,''cx-w1'',1,%L)',job,pg_temp.cx_outcome('published','17890000000000151')),'40001','C15 duplicate completion refused');
 perform pg_temp.replay_assert(pg_temp.cx_dispatches(d)=1 and (select remote_id='17890000000000151' from public.publication_deliveries where id=d),'C15 one dispatch, first id kept');
 reset role;
end $$;

-- C16 Duplicate retries / preparations: one delivery, one live job.
do $$declare d uuid:=pg_temp.cx_ready('google_business_profile','Chaos 16');pub uuid;c jsonb;job uuid;begin
 select publication_id into pub from public.publication_deliveries where id=d;
 set local role service_role;
 perform pg_temp.replay_assert(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id'=d::text and public.publication_prepare_delivery(pub,'user_local')->>'created'='false','C16 prepared twice: same delivery');
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('permanent',null,'provider_error'));
 perform public.publication_delivery_retry(d,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_delivery_retry(%L,''user_local'')',d),'55000','C16 double click: second retry refused');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_jobs where delivery_id=d and status in('pending','processing')),'C16 one live job');
 perform public.publication_delivery_cancel(d,'user_local');reset role;
end $$;

-- C17 Disconnection DURING the provider call (after the dispatch): the provider answer is still recorded (truth);
-- the next deliveries of that connection are blocked.
do $$declare d uuid:=pg_temp.cx_ready('google_business_profile','Chaos 17');n uuid;c jsonb;job uuid;cl uuid:=(select id from p10_ids where name='client');gbp uuid:=(select id from p10_ids where name='gbp_connection');begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 perform public.publication_connection_disconnect(cl,gbp,'user_local');
 perform public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('published','accounts/10/locations/1/localPosts/c17'));
 perform pg_temp.replay_assert((select status='published' and remote_id='accounts/10/locations/1/localPosts/c17' from public.publication_deliveries where id=d) and pg_temp.cx_dispatches(d)=1,'C17 provider truth recorded after the disconnection');
 reset role;n:=pg_temp.p10_publication('google_business_profile','Chaos 17 suivante');set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''user_local'')',n),'55000','C17 next publication not prepared while disconnected');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where publication_id=n),'C17 nothing queued');
 perform public.publication_connection_register(cl,'google_business_profile','vault:connection/'||gen_random_uuid()::text,null,null,null,'user_local');
 perform public.publication_accounts_sync(cl,gbp,jsonb_build_array(jsonb_build_object('platform','google_business_profile','external_account_id','accounts/10/locations/1','display_name','Toitures P10 — Lyon','parent_external_id','accounts/10','metadata','{}'::jsonb)),'user_local');
 perform public.publication_channel_assign_account((select id from p10_ids where name='social'),'google_business_profile',(select id from p10_ids where name='gbp_account'),'user_local');
 reset role;
end $$;

-- C19 Meta rate limit (Retry-After honoured, bounded) / C20 GBP quota (deterministic backoff, then max attempts).
do $$declare d uuid:=pg_temp.cx_ready('facebook','Chaos 19');g uuid;c jsonb;job uuid;r jsonb;i integer;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);
 perform pg_temp.replay_assert((c->>'delivery_id')::uuid=d,'C19 Meta job claimed');
 job:=(c->>'job_id')::uuid;perform public.publication_job_context(job,'cx-w1',1);perform public.publication_job_dispatch(job,'cx-w1',1);
 r:=public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('rate_limit',null,'rate_limited',3600));
 perform pg_temp.replay_assert(r->>'delivery_status'='retryable_error' and (select run_at>=now()+interval '59 minutes' and dispatched_at is null from public.publication_jobs where id=job),'C19 Meta rate limit: retry after the provider delay');
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w2',60) is null,'C19 not claimed again before the provider delay');
 reset role;g:=pg_temp.cx_ready('google_business_profile','Chaos 20');set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w2',60)->>'delivery_id'=g::text,'C20 GBP job claimed');
 job:=pg_temp.cx_job(g);
 for i in 1..5 loop
  if i>1 then perform pg_temp.cx_due(g);c:=public.publication_job_claim('cx-w2',60);
   if c is null or (c->>'delivery_id')::uuid<>g then raise exception 'C20 not reclaimed at attempt %',i; end if; end if;
  perform public.publication_job_context(job,'cx-w2',i);perform public.publication_job_dispatch(job,'cx-w2',i);
  r:=public.publication_job_complete(job,'cx-w2',i,pg_temp.cx_outcome('rate_limit',null,'rate_limited'));
 end loop;
 perform pg_temp.replay_assert(r->>'delivery_status'='failed' and (select count(*)=5 from public.publication_attempts where delivery_id=g),'C20 GBP quota: bounded attempts, then failed');
 perform pg_temp.replay_assert(public.publication_job_claim('cx-w2',60) is null or (public.publication_job_claim('cx-w3',60) is null),'C20 nothing more after max attempts');
 reset role;
end $$;

-- C13 Media missing / C14 signed URL expired: the worker never dispatches without media (engine, Node tests);
-- a provider refusal of the media is final (no automatic retry).
do $$declare d uuid:=pg_temp.cx_ready('instagram','Chaos 14');c jsonb;job uuid;r jsonb;begin
 set local role service_role;
 c:=public.publication_job_claim('cx-w1',60);job:=(c->>'job_id')::uuid;
 perform pg_temp.replay_assert(jsonb_array_length(public.publication_job_context(job,'cx-w1',1)->'assets')=1,'C13 snapshot media listed for signing');
 perform public.publication_job_dispatch(job,'cx-w1',1);
 r:=public.publication_job_complete(job,'cx-w1',1,pg_temp.cx_outcome('invalid_payload',null,'invalid_media'));
 perform pg_temp.replay_assert(r->>'delivery_status'='failed' and not exists(select 1 from public.publication_jobs where delivery_id=d and status in('pending','processing')),'C14 media refused: failed, no automatic retry');
 reset role;
end $$;

-- Global invariants after the whole chaos run.
select pg_temp.replay_assert(not exists(select 1 from public.publication_jobs where type='deliver' group by delivery_id having count(*) filter(where dispatched_at is not null and status='processing')>1),'never two in-flight dispatches for one delivery');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where status='published' and (remote_id is null or remote_id ~ '^simulated-')),'every publication has a real provider id');
-- Token prefixes matched case-sensitively (lowercase "eaab" can occur in random UUIDs).
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where metadata::text ~* '(vault:|secret|https?:)' or metadata::text ~ '(ya29\.|EAAB)'),'audit without secret or URL');
select pg_temp.replay_assert((select count(*) from public.publication_attempts a where a.result='uncertain' and exists(select 1 from public.publication_attempts b where b.delivery_id=a.delivery_id and b.attempt_number>a.attempt_number and b.job_id=a.job_id))=0,'no automatic attempt after an uncertain one');
