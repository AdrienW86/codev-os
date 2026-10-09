-- Lot 4.3 P10 — Delivery engine: prepare, claim, dispatch, complete, retry. Nothing reaches Meta or Google:
-- the only publisher in this lot is a local simulation, whose successes are recorded as 'simulated' (never
-- 'published') so the product history is never falsified. Publications themselves stay 'approved'.
-- Reuses publication_deliveries / publication_jobs / publication_attempts (Lot 1), additive and forward-only.
--
-- Delivery statuses (existing vocabulary kept, two added):
--  scheduled → processing | blocked | cancelled
--  processing → published | simulated | retryable_error | failed | uncertain | blocked
--  retryable_error → processing | scheduled | blocked | cancelled | failed
--  blocked (temporary: kill switch, channel / account / connection unusable, revision) → scheduled | cancelled
--  failed (permanent: max attempts, permanent error) → scheduled (manual retry) | blocked | cancelled
--  uncertain (outcome unknown after dispatch: reconcile) → published | failed | cancelled
--  published / simulated / cancelled: final.
-- Deliver jobs: pending (queued or waiting for its retry time) → processing (claimed, leased) → pending (retry) |
--  succeeded | failed | cancelled. At most once: a job whose lease expires AFTER the provider dispatch is never
--  executed again (its delivery becomes uncertain); before dispatch it can be reclaimed.

-- 1. Deliveries: immutable snapshot of what is sent.
do $$declare c record;dropped integer:=0;begin
 for c in select conname from pg_constraint where conrelid='public.publication_deliveries'::regclass
   and ((contype='c' and pg_get_constraintdef(oid) like '%status = ANY%') or (contype='u' and pg_get_constraintdef(oid)='UNIQUE (publication_id, publication_account_id)')) loop
  execute format('alter table public.publication_deliveries drop constraint %I',c.conname);dropped:=dropped+1;
 end loop;
 if dropped<>2 then raise exception 'Unexpected publication_deliveries constraints: %',dropped; end if;
end $$;
alter table public.publication_deliveries
 add constraint publication_deliveries_status_check check(status in('scheduled','processing','published','simulated','retryable_error','uncertain','blocked','cancelled','failed')),
 add column revision_id uuid,
 add column project_channel_id uuid references public.publication_project_channels(id) on delete restrict,
 add column text_hash text check(text_hash is null or text_hash ~ '^[a-f0-9]{64}$'),
 add column asset_ids uuid[] not null default '{}' check(cardinality(asset_ids)<=10),
 add column blocked_reason text check(blocked_reason is null or blocked_reason ~ '^[a-z_]{1,40}$'),
 add column last_error_class text check(last_error_class is null or last_error_class in('retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable')),
 add column last_error_code text check(last_error_code is null or last_error_code ~ '^[a-z0-9_.-]{1,80}$'),
 add constraint publication_deliveries_revision_fk foreign key(revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict,
 -- Engine rows (P10) always carry their full snapshot; legacy rows keep revision_id null.
 add constraint publication_deliveries_snapshot_check check(revision_id is null or (project_channel_id is not null and text_hash is not null)),
 add constraint publication_deliveries_simulated_check check((status<>'simulated' or remote_id ~ '^simulated-[a-zA-Z0-9_-]{1,100}$') and (status<>'published' or remote_id !~ '^simulated-'));
-- Only one live delivery per publication and account; superseded ones are cancelled (history kept).
create unique index publication_deliveries_live_account on public.publication_deliveries(publication_id,publication_account_id) where status<>'cancelled';
create index publication_deliveries_engine on public.publication_deliveries(status,scheduled_for) where revision_id is not null;

create function publications_private.guard_delivery_transition() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.revision_id,new.project_channel_id,new.text_hash,new.asset_ids,new.created_at) is distinct from (old.revision_id,old.project_channel_id,old.text_hash,old.asset_ids,old.created_at)
  or (old.revision_id is not null and new.variant_id is distinct from old.variant_id)
  or (old.remote_id is not null and new.remote_id is distinct from old.remote_id) then
  raise exception 'Delivery snapshot is immutable' using errcode='55000'; end if;
 if new.status=old.status or (old.status,new.status) in(
   ('scheduled','processing'),('scheduled','blocked'),('scheduled','cancelled'),
   ('processing','published'),('processing','simulated'),('processing','retryable_error'),('processing','failed'),('processing','uncertain'),('processing','blocked'),
   ('retryable_error','processing'),('retryable_error','scheduled'),('retryable_error','blocked'),('retryable_error','cancelled'),('retryable_error','failed'),
   ('blocked','scheduled'),('blocked','cancelled'),('failed','scheduled'),('failed','blocked'),('failed','cancelled'),
   ('uncertain','published'),('uncertain','failed'),('uncertain','cancelled')) then return new; end if;
 raise exception 'Illegal deliveries transition: resolve deliveries first' using errcode='55000';
end $$;
create trigger publication_delivery_transition before update on public.publication_deliveries
 for each row execute function publications_private.guard_delivery_transition();
create trigger publication_delivery_no_delete before delete on public.publication_deliveries
 for each row execute function publications_private.prevent_history_change();
create trigger publication_delivery_no_truncate before truncate on public.publication_deliveries
 for each statement execute function publications_private.prevent_history_change();

-- 2. Jobs: lease and dispatch marker; one live deliver job per delivery.
alter table public.publication_jobs
 add column lease_expires_at timestamptz,
 add column dispatched_at timestamptz,
 add column last_error_class text check(last_error_class is null or last_error_class in('retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable')),
 add constraint publication_jobs_lease_check check(type<>'deliver' or ((status='processing')=(lease_expires_at is not null))),
 add constraint publication_jobs_dispatch_check check(dispatched_at is null or status<>'pending');
create unique index publication_jobs_live_delivery on public.publication_jobs(delivery_id) where type='deliver' and status in('pending','processing');
create index publication_jobs_claim on public.publication_jobs(run_at,id) where type='deliver' and status in('pending','processing');

create function publications_private.guard_job_transition() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.type not in('deliver','reconcile') then return new; end if;
 if (new.type,new.publication_id,new.delivery_id,new.deduplication_key,new.created_at,new.max_attempts) is distinct from (old.type,old.publication_id,old.delivery_id,old.deduplication_key,old.created_at,old.max_attempts)
  or new.attempts<old.attempts then raise exception 'Job identity is immutable' using errcode='55000'; end if;
 if new.status=old.status and old.status in('pending','processing') then return new; end if;
 if (old.status,new.status) in(('pending','processing'),('pending','cancelled'),('processing','pending'),('processing','succeeded'),('processing','failed'),('processing','cancelled')) then return new; end if;
 raise exception 'Illegal job transition' using errcode='55000';
end $$;
create trigger publication_job_transition before update on public.publication_jobs
 for each row execute function publications_private.guard_job_transition();
create trigger publication_job_no_delete before delete on public.publication_jobs
 for each row execute function publications_private.prevent_history_change();
create trigger publication_job_no_truncate before truncate on public.publication_jobs
 for each statement execute function publications_private.prevent_history_change();

-- 3. Attempts (append-only already): normalized error, safe code, timing, simulation flag. Never provider text.
alter table public.publication_attempts
 add column error_class text check(error_class is null or error_class in('retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable')),
 add column error_code text check(error_code is null or error_code ~ '^[a-z0-9_.-]{1,80}$'),
 add column started_at timestamptz,
 add column simulated boolean not null default false;

-- 4. Helpers.
-- Deterministic retry schedule after attempt n: 1 min, 5 min, 15 min, 1 h, then 6 h. No jitter.
create function publications_private.delivery_retry_delay(p_attempt integer) returns interval
language sql immutable security invoker set search_path=pg_catalog as $$
 select case when p_attempt<=1 then interval '1 minute' when p_attempt=2 then interval '5 minutes' when p_attempt=3 then interval '15 minutes'
  when p_attempt=4 then interval '1 hour' else interval '6 hours' end;
$$;
create function publications_private.text_sha256(p_text text) returns text
language sql immutable security invoker set search_path=pg_catalog as $$ select encode(sha256(convert_to(coalesce(p_text,''),'UTF8')),'hex'); $$;
-- Why a delivery can run now ('ok' or a safe reason): kill switches and channel publishability (P9), channel
-- still bound to the delivery account, publication approved, not archived, still on the snapshot revision.
create function publications_private.delivery_readiness(p_delivery_id uuid) returns text
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select case
   when publications_private.channel_publishability(d.project_channel_id)<>'publishable' then publications_private.channel_publishability(d.project_channel_id)
   when not exists(select 1 from public.publication_project_channels c where c.id=d.project_channel_id and c.publication_account_id=d.publication_account_id) then 'account_changed'
   when p.archived_at is not null then 'archived'
   when p.status<>'approved' or p.current_revision_id is distinct from d.revision_id then 'publication_changed'
   when publications_private.text_sha256(v.text_content)<>d.text_hash then 'content_changed'
   else 'ok' end
  from public.publication_deliveries d join public.publications p on p.id=d.publication_id join public.publication_variants v on v.id=d.variant_id
  where d.id=p_delivery_id and d.revision_id is not null),'not_found');
$$;
-- Temporary block: delivery blocked with a safe reason, live job cancelled, audited (system).
create function publications_private.block_delivery(p_delivery_id uuid,p_reason text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;
begin
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if d.status in('published','simulated','cancelled','uncertain') then return; end if;
 update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null where delivery_id=d.id and type='deliver' and status in('pending','processing');
 update public.publication_deliveries set status='blocked',blocked_reason=left(p_reason,40) where id=d.id;
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata)
 values('system','publication.delivery_blocked',d.client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'platform',d.platform,'reason',left(p_reason,40)));
end $$;

-- 5. Prepare: one delivery (immutable snapshot) + one deliver job for an approved, publishable publication.
-- Idempotent on (variant, account): a second call returns the existing delivery, never a duplicate.
create function public.publication_prepare_delivery(p_publication_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare p public.publications;v public.publication_variants;ch public.publication_project_channels;d public.publication_deliveries;old public.publication_deliveries;
 reason text;key text;job uuid;assets uuid[];at timestamptz;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null then raise exception 'Invalid delivery request' using errcode='22023'; end if;
 select * into p from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if p.archived_at is not null then raise exception 'Archived publication' using errcode='55000'; end if;
 if p.status<>'approved' or p.current_revision_id is null then raise exception 'Publication not approved' using errcode='55000'; end if;
 if p.platform is null or p.project_id is null then raise exception 'Publication without platform or project' using errcode='23514'; end if;
 select * into v from public.publication_variants where revision_id=p.current_revision_id and publication_id=p.id and platform=p.platform;
 if not found then raise exception 'Variant missing' using errcode='23514'; end if;
 select * into ch from public.publication_project_channels where project_id=p.project_id and client_id=p.client_id and platform=p.platform for update;
 if not found then raise exception 'Channel not configured' using errcode='23514'; end if;
 if ch.publication_account_id is null then raise exception 'Not publishable: no_account' using errcode='55000'; end if;
 key:='deliver:'||v.id::text||':'||ch.publication_account_id::text;
 select * into d from public.publication_deliveries where idempotency_key=key;
 if found then return jsonb_build_object('delivery_id',d.id,'job_id',(select id from public.publication_jobs where delivery_id=d.id and type='deliver' order by created_at desc limit 1),'created',false,'status',d.status); end if;
 reason:=publications_private.channel_publishability(ch.id);
 if reason<>'publishable' then raise exception 'Not publishable: %',reason using errcode='55000'; end if;
 select coalesce(array_agg(va.asset_id order by va.sort_order),'{}') into assets from public.publication_variant_assets va where va.variant_id=v.id;
 if publications_private.platform_requires_media(p.platform) and cardinality(assets)=0 then raise exception 'Media required before delivery' using errcode='23514'; end if;
 -- An older live delivery of this publication / account (previous revision) is superseded unless already sent.
 select * into old from public.publication_deliveries where publication_id=p.id and publication_account_id=ch.publication_account_id and status<>'cancelled' for update;
 if found then
  if old.status in('processing','published','simulated','uncertain') then raise exception 'Resolve deliveries first' using errcode='55000'; end if;
  update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null where delivery_id=old.id and type='deliver' and status in('pending','processing');
  update public.publication_deliveries set status='cancelled' where id=old.id;
 end if;
 at:=greatest(now(),coalesce((select o.scheduled_for from public.publication_channel_occurrences o where o.id=p.occurrence_id),now()));
 insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key,revision_id,project_channel_id,text_hash,asset_ids)
 values(p.id,p.client_id,ch.publication_account_id,v.id,p.platform,at,key,p.current_revision_id,ch.id,publications_private.text_sha256(v.text_content),assets) returning * into d;
 insert into public.publication_jobs(type,publication_id,delivery_id,revision_id,deduplication_key,run_at,max_attempts)
 values('deliver',p.id,d.id,p.current_revision_id,'deliver:'||d.id::text||':1',at,5) returning id into job;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_prepared',p.client_id,'publication',p.id,
  jsonb_build_object('delivery_id',d.id,'job_id',job,'platform',p.platform,'account_id',ch.publication_account_id,'revision_id',p.current_revision_id,'superseded',old.id));
 return jsonb_build_object('delivery_id',d.id,'job_id',job,'created',true,'status',d.status);
end $$;

-- 6. Claim: next due job, FOR UPDATE SKIP LOCKED, deterministic order, bounded lease. Nothing while the emergency
-- stop is active. Expired leases: reclaimed if never dispatched, otherwise the delivery becomes uncertain.
create function public.publication_job_claim(p_worker_id text,p_lease_seconds integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare cand public.publication_jobs;d public.publication_deliveries;reason text;i integer:=0;
begin
 if p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9_.:-]{1,100}$' or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
  raise exception 'Invalid claim' using errcode='22023'; end if;
 if coalesce((select emergency_stop from public.publication_settings limit 1),true) then return null; end if;
 loop
  i:=i+1;exit when i>20;
  select j.* into cand from public.publication_jobs j
   where j.type='deliver' and ((j.status='pending' and j.run_at<=now()) or (j.status='processing' and j.lease_expires_at<=now()))
   order by j.run_at,j.id limit 1 for update of j skip locked;
  if not found then return null; end if;
  select * into d from public.publication_deliveries where id=cand.delivery_id for update;
  if d.status not in('scheduled','retryable_error','processing') or d.revision_id is null then
   update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null where id=cand.id;continue; end if;
  if cand.status='processing' and cand.dispatched_at is not null then
   -- The previous worker may have reached the provider: never send twice. Reconcile later.
   insert into public.publication_attempts(job_id,delivery_id,attempt_number,result,error_class,error_code,started_at)
   select cand.id,d.id,cand.attempts,'uncertain','provider_unavailable','lease_expired_after_dispatch',cand.dispatched_at
    where not exists(select 1 from public.publication_attempts where job_id=cand.id and attempt_number=cand.attempts);
   update public.publication_jobs set status='failed',locked_at=null,locked_by=null,lease_expires_at=null,last_error='lease_expired_after_dispatch',last_error_class='provider_unavailable' where id=cand.id;
   update public.publication_deliveries set status='uncertain',last_error_class='provider_unavailable',last_error_code='lease_expired_after_dispatch' where id=d.id;
   insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata)
   values('system','publication.delivery_uncertain',d.client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'job_id',cand.id,'attempt',cand.attempts));
   continue; end if;
  if cand.attempts>=cand.max_attempts then
   update public.publication_jobs set status='failed',locked_at=null,locked_by=null,lease_expires_at=null,last_error='max_attempts' where id=cand.id;
   update public.publication_deliveries set status='failed',last_error_code='max_attempts' where id=d.id;continue; end if;
  reason:=publications_private.delivery_readiness(d.id);
  if reason<>'ok' then perform publications_private.block_delivery(d.id,reason);continue; end if;
  update public.publication_jobs set status='processing',locked_at=now(),locked_by=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
   attempts=attempts+1,dispatched_at=null where id=cand.id returning * into cand;
  if d.status<>'processing' then update public.publication_deliveries set status='processing',blocked_reason=null where id=d.id; end if;
  return jsonb_build_object('job_id',cand.id,'delivery_id',d.id,'attempt',cand.attempts,'lease_expires_at',cand.lease_expires_at,'platform',d.platform);
 end loop;
 return null;
end $$;

-- Lease holder check shared by the worker RPCs.
create function publications_private.held_job(p_job_id uuid,p_worker_id text,p_attempt integer) returns public.publication_jobs
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.publication_jobs;
begin
 if p_job_id is null or p_worker_id is null or p_attempt is null then raise exception 'Invalid job request' using errcode='22023'; end if;
 select * into j from public.publication_jobs where id=p_job_id and type='deliver' for update;
 if not found or j.status<>'processing' or j.locked_by is distinct from p_worker_id or j.attempts<>p_attempt or j.lease_expires_at<=now() then
  raise exception 'Stale or foreign claim' using errcode='40001'; end if;
 return j;
end $$;

-- 7. Execution context (TOCTOU: everything re-checked now). Server only: text, snapshot assets (storage paths for
-- short-lived signed URLs) and the external account. Never any credential: the worker reads the vault itself.
create function public.publication_job_context(p_job_id uuid,p_worker_id text,p_attempt integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.publication_jobs;d public.publication_deliveries;reason text;a public.publication_accounts;
begin
 j:=publications_private.held_job(p_job_id,p_worker_id,p_attempt);
 select * into d from public.publication_deliveries where id=j.delivery_id for update;
 reason:=publications_private.delivery_readiness(d.id);
 if reason<>'ok' then perform publications_private.block_delivery(d.id,reason);return jsonb_build_object('status','blocked','reason',reason); end if;
 select * into a from public.publication_accounts where id=d.publication_account_id;
 return jsonb_build_object('status','ready','job_id',j.id,'delivery_id',d.id,'attempt',j.attempts,'platform',d.platform,'idempotency_key',d.idempotency_key,
  'text',(select text_content from public.publication_variants where id=d.variant_id),'text_hash',d.text_hash,'connection_id',a.connection_id,
  'account',jsonb_build_object('id',a.id,'external_account_id',a.external_account_id,'parent_external_id',a.parent_external_id),
  'assets',(select coalesce(jsonb_agg(jsonb_build_object('asset_id',x.id,'storage_path',x.storage_path,'mime_type',x.mime_type) order by u.ord),'[]'::jsonb)
   from unnest(d.asset_ids) with ordinality u(id,ord) join public.publication_assets x on x.id=u.id and x.client_id=d.client_id));
end $$;

-- 8. Dispatch marker, set just before the provider call (last kill-switch check). After it, a lost lease never
-- leads to a second send.
create function public.publication_job_dispatch(p_job_id uuid,p_worker_id text,p_attempt integer) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.publication_jobs;reason text;
begin
 j:=publications_private.held_job(p_job_id,p_worker_id,p_attempt);
 if j.dispatched_at is not null then raise exception 'Already dispatched' using errcode='55000'; end if;
 reason:=publications_private.delivery_readiness(j.delivery_id);
 if reason<>'ok' then perform publications_private.block_delivery(j.delivery_id,reason);return false; end if;
 update public.publication_jobs set dispatched_at=now() where id=j.id;
 return true;
end $$;

-- 9. Completion of the held attempt: append-only attempt, delivery and job finalized, retry scheduled.
-- p_outcome = {result: simulated|published|retryable|permanent|auth|rate_limit|invalid_payload|provider_unavailable|uncertain,
--  remote_id?, error_code?, retry_after_seconds?, duration_ms, request_id?}. Never provider text.
create function public.publication_job_complete(p_job_id uuid,p_worker_id text,p_attempt integer,p_outcome jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.publication_jobs;d public.publication_deliveries;r text;code text;remote text;duration integer;wait interval;next_status text;job_status text;delivery_status text;klass text;
begin
 if jsonb_typeof(p_outcome) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_outcome) k where k not in('result','remote_id','error_code','retry_after_seconds','duration_ms','request_id')) then
  raise exception 'Invalid outcome' using errcode='22023'; end if;
 r:=p_outcome->>'result';code:=p_outcome->>'error_code';remote:=p_outcome->>'remote_id';
 duration:=case when jsonb_typeof(p_outcome->'duration_ms')='number' then (p_outcome->>'duration_ms')::integer end;
 if r is null or r not in('simulated','published','retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable','uncertain')
  or (code is not null and code !~ '^[a-z0-9_.-]{1,80}$') or duration is null or duration<0
  or (r in('simulated','published') and (remote is null or length(remote) not between 1 and 500))
  or (p_outcome->>'request_id' is not null and p_outcome->>'request_id' !~ '^[a-zA-Z0-9_-]{1,128}$') then raise exception 'Invalid outcome' using errcode='22023'; end if;
 j:=publications_private.held_job(p_job_id,p_worker_id,p_attempt);
 if j.dispatched_at is null then raise exception 'Not dispatched' using errcode='55000'; end if;
 select * into d from public.publication_deliveries where id=j.delivery_id for update;
 klass:=case when r in('retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable') then r end;
 if r in('simulated','published') then job_status:='succeeded';delivery_status:=r;
 elsif r='uncertain' then job_status:='failed';delivery_status:='uncertain';
 elsif r in('retryable','rate_limit','provider_unavailable') then
  if j.attempts<j.max_attempts then job_status:='pending';delivery_status:='retryable_error';
   wait:=publications_private.delivery_retry_delay(j.attempts);
   if r='rate_limit' and jsonb_typeof(p_outcome->'retry_after_seconds')='number' then
    wait:=greatest(wait,make_interval(secs=>least(greatest((p_outcome->>'retry_after_seconds')::numeric,0),21600)::double precision)); end if;
  else job_status:='failed';delivery_status:='failed'; end if;
 elsif r='auth' then job_status:='failed';delivery_status:='blocked';
 else job_status:='failed';delivery_status:='failed'; end if;
 insert into public.publication_attempts(job_id,delivery_id,attempt_number,result,error_class,error_code,request_id,duration_ms,started_at,simulated)
 values(j.id,d.id,j.attempts,case when r in('simulated','published') then 'succeeded' when r='uncertain' then 'uncertain' when delivery_status='retryable_error' then 'retryable_error'
   when r='auth' then 'blocked' else 'failed' end,klass,code,p_outcome->>'request_id',duration,j.dispatched_at,r='simulated');
 update public.publication_jobs set status=job_status,locked_at=null,locked_by=null,lease_expires_at=null,
  dispatched_at=case when job_status='pending' then null else dispatched_at end,run_at=case when job_status='pending' then now()+wait else run_at end,
  last_error=case when klass is null then null else coalesce(code,klass) end,last_error_class=klass where id=j.id;
 update public.publication_deliveries set status=delivery_status,remote_id=case when delivery_status in('published','simulated') then remote else remote_id end,
  last_error_class=klass,last_error_code=code,blocked_reason=case when delivery_status='blocked' then 'auth' end where id=d.id;
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata)
 values('worker','publication.delivery_attempted',d.client_id,'publication',d.publication_id,
  jsonb_build_object('delivery_id',d.id,'job_id',j.id,'attempt',j.attempts,'result',r,'error_class',klass,'error_code',code,'delivery_status',delivery_status,'simulated',r='simulated'));
 return jsonb_build_object('delivery_id',d.id,'job_status',job_status,'delivery_status',delivery_status,
  'next_attempt_at',case when job_status='pending' then now()+wait end);
end $$;

-- 10. Admin: retry (same delivery, no duplicate; re-checked now) and cancel (permanent, history kept).
create function public.publication_delivery_retry(p_delivery_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;reason text;job uuid;n integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null then raise exception 'Invalid retry' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status not in('failed','retryable_error','blocked') then raise exception 'Delivery cannot be retried' using errcode='55000'; end if;
 reason:=publications_private.delivery_readiness(d.id);
 if reason<>'ok' then raise exception 'Not publishable: %',reason using errcode='55000'; end if;
 select id into job from public.publication_jobs where delivery_id=d.id and type='deliver' and status in('pending','processing') for update;
 if found then update public.publication_jobs set run_at=now() where id=job and status='pending';
 else
  select count(*)+1 into n from public.publication_jobs where delivery_id=d.id and type='deliver';
  insert into public.publication_jobs(type,publication_id,delivery_id,revision_id,deduplication_key,run_at,max_attempts)
  values('deliver',d.publication_id,d.id,d.revision_id,'deliver:'||d.id::text||':'||n::text,now(),5) returning id into job;
 end if;
 if d.status<>'retryable_error' then update public.publication_deliveries set status='scheduled',blocked_reason=null where id=d.id; end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_retried',d.client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'job_id',job,'from',d.status));
 return jsonb_build_object('delivery_id',d.id,'job_id',job);
end $$;
create function public.publication_delivery_cancel(p_delivery_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null then raise exception 'Invalid cancel' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status='cancelled' then return jsonb_build_object('delivery_id',d.id,'status','cancelled','already',true); end if;
 if d.status not in('scheduled','retryable_error','blocked','failed') then raise exception 'Delivery cannot be cancelled' using errcode='55000'; end if;
 update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null where delivery_id=d.id and type='deliver' and status in('pending','processing');
 update public.publication_deliveries set status='cancelled' where id=d.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_cancelled',d.client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'from',d.status));
 return jsonb_build_object('delivery_id',d.id,'status','cancelled','already',false);
end $$;

-- 11. Archive (P5) also accepts deliveries that are final without a send in progress (failed, simulated).
create or replace function public.publication_archive(p_publication_id uuid,p_actor_id text) returns timestamptz
language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;archived timestamptz;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null then
  raise exception 'Invalid archive' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.archived_at is not null then raise exception 'Publication already archived' using errcode='55000'; end if;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status not in('cancelled','published','simulated','failed')) then
  raise exception 'Resolve deliveries first' using errcode='55000'; end if;
 update public.publications set archived_at=now(),archived_by=p_actor_id where id=pub.id returning archived_at into archived;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.archived',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'publication_id',pub.id,'platform',pub.platform,'occurrence_id',pub.occurrence_id,
   'editorial_group_id',pub.editorial_group_id,'status',pub.status));
 return archived;
end $$;

revoke all on function publications_private.guard_delivery_transition(),publications_private.guard_job_transition(),publications_private.delivery_retry_delay(integer),
 publications_private.text_sha256(text),publications_private.delivery_readiness(uuid),publications_private.block_delivery(uuid,text),
 publications_private.held_job(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_delivery_transition(),publications_private.guard_job_transition(),publications_private.delivery_retry_delay(integer),
 publications_private.text_sha256(text),publications_private.delivery_readiness(uuid),publications_private.block_delivery(uuid,text),
 publications_private.held_job(uuid,text,integer) to service_role;
revoke all on function public.publication_prepare_delivery(uuid,text),public.publication_job_claim(text,integer),public.publication_job_context(uuid,text,integer),
 public.publication_job_dispatch(uuid,text,integer),public.publication_job_complete(uuid,text,integer,jsonb),public.publication_delivery_retry(uuid,text),
 public.publication_delivery_cancel(uuid,text) from public,anon,authenticated;
grant execute on function public.publication_prepare_delivery(uuid,text),public.publication_job_claim(text,integer),public.publication_job_context(uuid,text,integer),
 public.publication_job_dispatch(uuid,text,integer),public.publication_job_complete(uuid,text,integer,jsonb),public.publication_delivery_retry(uuid,text),
 public.publication_delivery_cancel(uuid,text) to service_role;
