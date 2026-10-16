-- Disposable local PostgreSQL fixture only. The full migration chain is already installed.
-- No provider calls, no real customer, no external publication.
create function pg_temp.rc_uncertain(p_platform text,p_text text) returns uuid language plpgsql as $$
declare pub uuid;d uuid;c jsonb;
begin
 pub:=pg_temp.load_publication(1,p_platform,p_text);
 set local role service_role;
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 reset role;
 update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=d and type='deliver' and status='pending';
 set local role service_role;
 c:=public.publication_job_claim('reconcile-fixture',60);
 if (c->>'delivery_id')::uuid is distinct from d then raise exception 'Unexpected fixture claim'; end if;
 perform public.publication_job_dispatch((c->>'job_id')::uuid,'reconcile-fixture',(c->>'attempt')::integer);
 perform public.publication_job_complete((c->>'job_id')::uuid,'reconcile-fixture',(c->>'attempt')::integer,
  '{"result":"uncertain","error_code":"timeout_after_dispatch","duration_ms":20000}');
 reset role;return d;
end $$;
create function pg_temp.rc_retry_uncertain(p_delivery uuid) returns uuid language plpgsql as $$
declare c jsonb;
begin
 set local role service_role;
 perform public.publication_delivery_retry(p_delivery,'user_local');
 c:=public.publication_job_claim('reconcile-fixture',60);
 if (c->>'delivery_id')::uuid is distinct from p_delivery then raise exception 'Unexpected retry claim'; end if;
 perform public.publication_job_dispatch((c->>'job_id')::uuid,'reconcile-fixture',(c->>'attempt')::integer);
 perform public.publication_job_complete((c->>'job_id')::uuid,'reconcile-fixture',(c->>'attempt')::integer,
  '{"result":"uncertain","error_code":"timeout_after_dispatch","duration_ms":20000}');
 return (public.publication_delivery_reconcile_context_checked(p_delivery)->>'attempt_id')::uuid;
end $$;
grant execute on function pg_temp.rc_uncertain(text,text),pg_temp.rc_retry_uncertain(uuid) to service_role;

select pg_temp.load_client(1);
do $$declare f text;r text;
begin
 foreach f in array array['public.publication_delivery_reconcile_context_checked(uuid)',
  'public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text)',
  'public.publication_delivery_confirm_not_published_checked(uuid,text)',
  'publications_private.remember_delivery_attempt()','publications_private.checked_uncertain_attempt(uuid)'] loop
  foreach r in array array['public','anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser cannot call '||f);
  end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server may call '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed path '||f);
 end loop;
 foreach f in array array['public.publication_delivery_reconcile_context(uuid)',
  'public.publication_delivery_reconcile(uuid,text,text,text)','public.publication_delivery_confirm_not_published(uuid,text)'] loop
  perform pg_temp.replay_assert(not has_function_privilege('service_role',f,'EXECUTE'),'unsafe historical endpoint revoked '||f);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_delivery_reconcile_context_checked(null)','42501','anon context denied');
reset role;

do $$declare d uuid:=pg_temp.rc_uncertain('facebook','Proof belongs to one attempt');a uuid;b uuid;c uuid;proof uuid;ctx jsonb;
begin
 set local role service_role;
 ctx:=public.publication_delivery_reconcile_context_checked(d);a:=(ctx->>'attempt_id')::uuid;
 perform pg_temp.replay_assert(a is not null and ctx->>'since' is not null and ctx->>'text'='Proof belongs to one attempt','context bound to the actual uncertain attempt');
 perform pg_temp.replay_assert(ctx::text !~* '(vault:|token|credential|secret)','context excludes credentials');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published_checked(%L,''user_local'')',d),'55000','no confirmation without current check');
 -- Even an old missing event for this same delivery cannot act as proof.
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 select 'admin','user_local','publication.delivery_reconciled',client_id,'publication',publication_id,
  jsonb_build_object('delivery_id',id,'result','missing') from public.publication_deliveries where id=d;
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published_checked(%L,''user_local'')',d),'55000','historical missing event cannot authorize retry');
 perform public.publication_delivery_reconcile_checked(d,a,'missing',null,'user_local');
 select last_reconciliation_id into proof from public.publication_deliveries where id=d;
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where id=proof and metadata->>'attempt_id'=a::text and metadata->>'result'='missing'),'proof points to immutable event for the current attempt');
 perform public.publication_delivery_confirm_not_published_checked(d,'user_local');
 perform pg_temp.replay_assert((select status='failed' and last_reconciliation_id is null from public.publication_deliveries where id=d),'explicit confirmation consumes the proof');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published_checked(%L,''user_local'')',d),'55000','same proof cannot be confirmed twice');

 -- Retry creates a new job with attempt_number=1 at exactly the same transaction timestamp.
 -- Comparing UUID or timestamps would choose arbitrary history; the server-maintained pointer must choose b.
 b:=pg_temp.rc_retry_uncertain(d);
 perform pg_temp.replay_assert(a<>b and (select count(distinct created_at)=1 from public.publication_attempts where delivery_id=d),'new uncertain attempt at the same timestamp');
 perform pg_temp.replay_assert((select last_attempt_id=b and last_reconciliation_id is null from public.publication_deliveries where id=d),'new attempt invalidates old proof');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published_checked(%L,''user_local'')',d),'55000','old missing followed by retry and new uncertain cannot authorize retry');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_checked(%L,%L,''missing'',null,''user_local'')',d,a),'40001','stale provider response from previous attempt rejected');
 perform public.publication_delivery_reconcile_checked(d,b,'missing',null,'user_local');
 perform public.publication_delivery_reconcile_checked(d,b,'unknown',null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_delivery_confirm_not_published_checked(%L,''user_local'')',d),'55000','unknown invalidates previous missing');
 perform pg_temp.replay_assert((select e.metadata->>'result'='unknown' from public.publication_deliveries x join public.publication_events e on e.id=x.last_reconciliation_id where x.id=d),'latest proof is unknown');
 perform public.publication_delivery_reconcile_checked(d,b,'missing',null,'user_local');
 perform public.publication_delivery_confirm_not_published_checked(d,'user_local');
 c:=pg_temp.rc_retry_uncertain(d);
 perform pg_temp.replay_assert(c<>b,'second retry is a distinct attempt');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_checked(%L,%L,''exists'',''1001_8'',''user_local'')',d,b),'40001','stale exists cannot publish a different attempt');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_checked(%L,%L,null,null,''user_local'')',d,c),'22023','null status refused');
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_checked(%L,%L,''exists'',''simulated-bad'',''user_local'')',d,c),'22023','simulated id cannot prove publication');
 perform public.publication_delivery_reconcile_checked(d,c,'exists','1001_99','user_local');
 perform pg_temp.replay_assert((select status='published' and remote_id='1001_99' from public.publication_deliveries where id=d),'current exists marks published with actual provider id');
 reset role;
end $$;

do $$declare d uuid:=pg_temp.rc_uncertain('google_business_profile','GBP location check');a uuid;
begin
 set local role service_role;
 a:=(public.publication_delivery_reconcile_context_checked(d)->>'attempt_id')::uuid;
 perform pg_temp.replay_failure(format('select public.publication_delivery_reconcile_checked(%L,%L,''exists'',''accounts/l1/locations/OTHER/localPosts/1'',''user_local'')',d,a),'22023','foreign GBP location refused');
 perform public.publication_delivery_reconcile_checked(d,a,'exists','accounts/l1/locations/1/localPosts/123','user_local');
 perform pg_temp.replay_assert((select status='published' from public.publication_deliveries where id=d),'matching GBP location accepted');
 reset role;
end $$;

-- Persist this final missing proof so two independent connections can race for the single explicit decision.
create temporary table checked_concurrent_id(id uuid);
grant select on checked_concurrent_id to service_role;
insert into checked_concurrent_id values(pg_temp.rc_uncertain('facebook','Concurrent explicit decision'));
set local role service_role;
do $$declare d uuid:=(select id from checked_concurrent_id);a uuid;begin
 a:=(public.publication_delivery_reconcile_context_checked(d)->>'attempt_id')::uuid;
 perform public.publication_delivery_reconcile_checked(d,a,'missing',null,'user_local');
end $$;
reset role;
select 'CONCURRENT_DELIVERY='||id from checked_concurrent_id;
select 'CHECKED_RECONCILIATION='||passed from pg_temp.remote_replay;
