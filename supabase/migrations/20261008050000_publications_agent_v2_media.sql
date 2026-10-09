-- Lot 4.3 P8 — Agent v2 media pipeline and approval invariant.
-- The Drive photo chosen by Agent v2 is fetched, validated and uploaded by the server (external I/O), then attached
-- to the run's sister drafts by ONE atomic RPC. publication_media_uses is the authority on media usage.
-- Media steps of a completed run: none (no media) | pending (reserved, being attached) | attached | needs_media
-- (drafts kept, media NOT attached: explicit state, approval stays impossible until a media is attached).
-- Forward-only. No delivery, job, publisher or cron. Existing approved publications are never re-checked.

-- 1. Media capability per platform. SQL mirror of PLATFORM_MEDIA_REQUIREMENT (lib/publications/channels.ts).
-- Current product rule (kept): every platform (Facebook, Instagram, Google Business Profile) requires a media
-- before approval. Instagram cannot publish without one; Facebook / GBP keep the stricter historical rule.
create function publications_private.platform_requires_media(p_platform text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(p_platform in('facebook','instagram','google_business_profile'),false);
$$;

-- 2. Approval invariant (Brouillon → À publier): every variant of the current revision whose platform requires a
-- media carries at least one asset of the same client with confirmed rights. Enforced on the status transition
-- itself, whatever the caller (review RPC or direct update); already approved rows stay untouched (legacy).
create function publications_private.check_media_before_approval() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publication_variants v
   where v.revision_id=new.current_revision_id and v.publication_id=new.id and v.client_id=new.client_id
    and publications_private.platform_requires_media(v.platform)
    and not exists(select 1 from public.publication_variant_assets va
     join public.publication_assets a on a.id=va.asset_id and a.client_id=va.client_id
     where va.variant_id=v.id and va.client_id=new.client_id and a.rights_confirmed)) then
  raise exception 'Media required before approval' using errcode='23514'; end if;
 return new;
end $$;
create trigger publications_media_before_approval before update of status on public.publications
 for each row when (new.status='approved' and old.status is distinct from 'approved')
 execute function publications_private.check_media_before_approval();

-- 3. Media state of Agent v2 runs.
alter table public.publication_agent_v2_runs
 add constraint publication_agent_v2_runs_id_client unique(id,client_id),
 add column media_status text not null default 'none' check(media_status in('none','pending','attached','needs_media')),
 add column media_error_code text check(media_error_code in('media_unavailable','fetch_failed','invalid_media','upload_failed','attach_failed','not_attached')),
 add column media_attempts integer not null default 0 check(media_attempts between 0 and 20),
 add column media_lease_until timestamptz,
 add column media_attached_at timestamptz;
-- P7 runs completed with a suggested media never had it attached: explicit needs_media (no silent half-state).
alter table public.publication_agent_v2_runs disable trigger agent_v2_run_guard;
update public.publication_agent_v2_runs set media_status='needs_media',media_error_code='not_attached'
 where status='completed' and selected_media_id is not null;
alter table public.publication_agent_v2_runs enable trigger agent_v2_run_guard;
alter table public.publication_agent_v2_runs
 add constraint publication_agent_v2_runs_media_scope check(media_status='none' or (status='completed' and selected_media_id is not null)),
 add constraint publication_agent_v2_runs_media_selected check(status<>'completed' or selected_media_id is null or media_status<>'none'),
 add constraint publication_agent_v2_runs_media_error check((media_status='needs_media')=(media_error_code is not null)),
 add constraint publication_agent_v2_runs_media_attached check((media_status='attached')=(media_attached_at is not null)),
 add constraint publication_agent_v2_runs_media_lease check(media_lease_until is null or media_status='pending');

-- Generation fields stay immutable once the run is closed; only the media step of a completed run moves, along
-- pending → pending (new attempt) | attached | needs_media and needs_media → pending (retry). none / attached are final.
create or replace function publications_private.guard_agent_v2_run() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.agent_run_id,new.agent_id,new.client_id,new.project_id,new.occurrence_ids,new.considered_count,new.created_at,new.reserved_cost_eur)
    is distinct from (old.id,old.agent_run_id,old.agent_id,old.client_id,old.project_id,old.occurrence_ids,old.considered_count,old.created_at,old.reserved_cost_eur) then
  raise exception 'Agent run is immutable' using errcode='55000'; end if;
 if old.status='processing' then
  if new.media_attempts<>0 or new.media_lease_until is not null or new.media_status not in('none','pending') then
   raise exception 'Agent run is immutable' using errcode='55000'; end if;
  return new; end if;
 if old.status<>'completed'
  or (new.status,new.completed_at,new.selected_media_id,new.editorial_group_id,new.publication_ids,new.estimated_cost_eur,new.input_tokens,new.output_tokens,new.model,new.error_code,new.lease_until)
   is distinct from (old.status,old.completed_at,old.selected_media_id,old.editorial_group_id,old.publication_ids,old.estimated_cost_eur,old.input_tokens,old.output_tokens,old.model,old.error_code,old.lease_until)
  or (old.media_status,new.media_status) not in(('pending','pending'),('pending','attached'),('pending','needs_media'),('needs_media','pending'))
  or new.media_attempts<old.media_attempts then
  raise exception 'Agent run is immutable' using errcode='55000'; end if;
 return new;
end $$;

-- 4. Reservation of a Drive media by an Agent v2 run (Agent v1 keeps claimed_run_id; never both).
alter table public.publication_drive_media
 add column claimed_agent_v2_run_id uuid,
 add constraint publication_drive_media_v2_claim_fk foreign key(claimed_agent_v2_run_id,client_id)
  references public.publication_agent_v2_runs(id,client_id) on delete restrict,
 add constraint publication_drive_media_single_claim check(claimed_run_id is null or claimed_agent_v2_run_id is null);
create index publication_drive_media_v2_claim on public.publication_drive_media(claimed_agent_v2_run_id) where claimed_agent_v2_run_id is not null;
-- Usage authority: one use per source media, publication and platform (whatever the revision).
create unique index publication_media_uses_publication_platform on public.publication_media_uses(media_id,publication_id,platform);

-- Agent v1 reservation also refuses a media reserved by Agent v2 (same body, one more condition).
create or replace function public.publication_ai_claim_media(p_run uuid,p_media uuid,p_hash text,p_analysis jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_ai_runs;m public.publication_drive_media;
begin
 select * into r from public.publication_ai_runs where id=p_run and status='processing' and lease_until>now() for update;if not found then raise exception 'Run invalid' using errcode='40001';end if;
 select * into m from public.publication_drive_media where id=p_media and client_id=r.client_id for update;
 if not found or m.claimed_run_id is not null and m.claimed_run_id<>r.id or m.claimed_agent_v2_run_id is not null or exists(select 1 from public.publication_media_uses where media_id=m.id)
 or exists(select 1 from public.publication_assets a join public.publication_variant_assets v on v.asset_id=a.id where a.client_id=r.client_id and a.file_hash=p_hash)
 or not exists(select 1 from public.publication_agent_projects where project_id=r.project_id and client_id=r.client_id and enabled and rights_confirmed and drive_folder_id=m.drive_folder_id)
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_analysis) is distinct from 'object'
 or not agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id) then raise exception 'Media unavailable or reused' using errcode='23514';end if;
 update public.publication_drive_media set file_hash=p_hash,analysis=p_analysis,claimed_run_id=r.id where id=m.id;
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata) values('system','publication.media_reserved',r.client_id,'publication',r.publication_id,jsonb_build_object('media_id',m.id,'run_id',r.id));
end $$;

-- Server-side guard shared by the media RPCs: the media must be the run's own selection, of its client, in the
-- project's configured Drive folder, usable, an accepted image within the size limit, with confirmed rights, never
-- used and not reserved by another run. Ids sent by a browser are never trusted.
create function publications_private.agent_v2_media_available(r public.publication_agent_v2_runs,m public.publication_drive_media) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(m.id is not null and m.id=r.selected_media_id and m.client_id=r.client_id
  and m.analysis->'usable'='true'::jsonb and m.mime_type in('image/jpeg','image/png','image/webp') and m.file_size between 1 and 8388608
  and m.claimed_run_id is null and (m.claimed_agent_v2_run_id is null or m.claimed_agent_v2_run_id=r.id)
  and not exists(select 1 from public.publication_media_uses u where u.media_id=m.id)
  and exists(select 1 from public.publication_agent_projects c where c.project_id=r.project_id and c.client_id=r.client_id
   and c.enabled and c.rights_confirmed and c.drive_folder_id=m.drive_folder_id)
  and agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id),false);
$$;
-- A draft of the run can receive the media: same client, not archived, still a draft (or submitted, not reviewed),
-- no delivery, and its current revision has exactly its mono-platform variant.
create function publications_private.agent_v2_media_target(r public.publication_agent_v2_runs,p public.publications) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
 select v.id from public.publication_variants v
  where p.id is not null and p.id=any(r.publication_ids) and p.client_id=r.client_id and p.project_id=r.project_id and p.archived_at is null
   and p.status in('draft','pending_review') and p.platform is not null and p.current_revision_id is not null
   and not exists(select 1 from public.publication_deliveries d where d.publication_id=p.id)
   and not exists(select 1 from public.publication_reviews rv where rv.revision_id=p.current_revision_id)
   and v.revision_id=p.current_revision_id and v.publication_id=p.id and v.client_id=p.client_id and v.platform=p.platform;
$$;

-- 5. Finish (same signature as P7): the suggested media is checked with the shared guard and reserved by the run
-- in the same transaction as the drafts (media_status pending). Attachment happens after the server I/O.
create or replace function public.publication_agent_v2_finish(p_run_id uuid,p_output jsonb,p_media_id uuid,p_usage jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;item jsonb;subject text;angle text;created jsonb;group_id uuid;ids uuid[]:=array[]::uuid[];seen uuid[]:=array[]::uuid[];
 occurrence uuid;cost numeric;tokens_in integer;tokens_out integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null
  or jsonb_typeof(p_output) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_output) k) is distinct from array['idea','publications']
  or jsonb_typeof(p_output->'idea') is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_output->'idea') k) is distinct from array['angle','subject']
  or jsonb_typeof(p_output->'publications') is distinct from 'array'
  or jsonb_typeof(p_usage) is distinct from 'object' or jsonb_typeof(p_usage->'input_tokens') is distinct from 'number' or jsonb_typeof(p_usage->'output_tokens') is distinct from 'number'
  or jsonb_typeof(p_usage->'estimated_cost_eur') is distinct from 'number' then
  raise exception 'Invalid agent output' using errcode='22023'; end if;
 subject:=btrim(p_output->'idea'->>'subject');angle:=btrim(p_output->'idea'->>'angle');
 tokens_in:=(p_usage->>'input_tokens')::integer;tokens_out:=(p_usage->>'output_tokens')::integer;cost:=(p_usage->>'estimated_cost_eur')::numeric;
 if subject is null or length(subject) not between 1 and 300 or angle is null or length(angle) not between 1 and 3000
  or tokens_in<0 or tokens_out<0 or cost<0 or cost>.1 then raise exception 'Invalid agent output' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'processing' or r.lease_until<=now() then raise exception 'Agent run not active' using errcode='55000'; end if;
 if jsonb_array_length(p_output->'publications')<>cardinality(r.occurrence_ids) then raise exception 'Invalid agent output' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_output->'publications') loop
  if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['cta','occurrence_id','text']
   or jsonb_typeof(item->'occurrence_id') is distinct from 'string' or jsonb_typeof(item->'text') is distinct from 'string'
   or jsonb_typeof(item->'cta') not in('string','null') then raise exception 'Invalid agent output' using errcode='22023'; end if;
  occurrence:=(item->>'occurrence_id')::uuid;
  if not (occurrence=any(r.occurrence_ids)) or occurrence=any(seen) then raise exception 'Invalid agent output' using errcode='22023'; end if;
  seen:=seen||occurrence;
 end loop;
 if p_media_id is not null then
  select * into m from public.publication_drive_media where id=p_media_id and client_id=r.client_id for update;
  r.selected_media_id:=p_media_id;
  if not publications_private.agent_v2_media_available(r,m) or m.claimed_agent_v2_run_id is not null then
   raise exception 'Invalid agent media' using errcode='22023'; end if;
 end if;
 for item in select value from jsonb_array_elements(p_output->'publications') order by value->>'occurrence_id' loop
  created:=publications_private.create_publication_from_occurrence((item->>'occurrence_id')::uuid,group_id,
   case when group_id is null and cardinality(r.occurrence_ids)>1 then subject end,subject,angle,item->>'text',
   case when jsonb_typeof(item->'cta')='string' and btrim(item->>'cta')<>'' then jsonb_build_object('cta',btrim(item->>'cta')) else '{}'::jsonb end,p_actor_id,'agent');
  group_id:=coalesce(group_id,(created->>'editorial_group_id')::uuid);ids:=ids||(created->>'publication_id')::uuid;
 end loop;
 update public.publication_agent_v2_runs set status='completed',completed_at=now(),publication_ids=ids,editorial_group_id=group_id,selected_media_id=p_media_id,
  input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost,media_status=case when p_media_id is null then 'none' else 'pending' end where id=r.id;
 if p_media_id is not null then update public.publication_drive_media set claimed_agent_v2_run_id=r.id where id=p_media_id; end if;
 update public.agent_runs set status='completed',completed_at=now(),summary='Prepared drafts for human review',input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost,
  metadata=metadata||jsonb_build_object('agent_v2_run_id',r.id,'publications',cardinality(ids)) where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_completed',r.client_id,'project',r.project_id,
  jsonb_build_object('run_id',r.id,'project_id',r.project_id,'occurrence_ids',to_jsonb(r.occurrence_ids),'publication_ids',to_jsonb(ids),
   'editorial_group_id',group_id,'with_media',p_media_id is not null));
 return jsonb_build_object('run_id',r.id,'publication_ids',to_jsonb(ids),'editorial_group_id',group_id,'media_status',case when p_media_id is null then 'none' else 'pending' end);
end $$;

-- 6. Start of a media attempt (first attempt after finish, or explicit retry of a needs_media run; never any AI).
-- Re-checks the media and every target, refreshes the reservation and returns the server-side descriptor needed
-- to fetch the file (service role only; never sent to a browser).
create function public.publication_agent_v2_media_claim(p_run_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;p public.publications;variant uuid;targets jsonb:='[]'::jsonb;pid uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null then raise exception 'Invalid media request' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where publication_agent_v2_runs.id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status='attached' then return jsonb_build_object('run_id',r.id,'media_status','attached','attempt',r.media_attempts); end if;
 if r.media_status='pending' and r.media_lease_until>now() then raise exception 'Media step in progress' using errcode='55P03'; end if;
 select * into m from public.publication_drive_media where publication_drive_media.id=r.selected_media_id and client_id=r.client_id for update;
 if not publications_private.agent_v2_media_available(r,m) then raise exception 'Media unavailable' using errcode='23514'; end if;
 foreach pid in array (select array_agg(x order by x) from unnest(r.publication_ids) x) loop
  select * into p from public.publications where publications.id=pid for update;
  variant:=publications_private.agent_v2_media_target(r,p);
  if variant is null then raise exception 'Media target unavailable' using errcode='23514'; end if;
  targets:=targets||jsonb_build_array(jsonb_build_object('publication_id',p.id,'revision_id',p.current_revision_id,'variant_id',variant,'platform',p.platform));
 end loop;
 update public.publication_drive_media set claimed_agent_v2_run_id=r.id where publication_drive_media.id=m.id and claimed_agent_v2_run_id is distinct from r.id;
 update public.publication_agent_v2_runs set media_status='pending',media_error_code=null,media_attempts=media_attempts+1,media_lease_until=now()+interval '10 minutes'
  where publication_agent_v2_runs.id=r.id returning * into r;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_claimed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'media_id',m.id,'attempt',r.media_attempts));
 return jsonb_build_object('run_id',r.id,'media_status','pending','attempt',r.media_attempts,'client_id',r.client_id,
  'media',jsonb_build_object('id',m.id,'drive_file_id',m.drive_file_id,'drive_folder_id',m.drive_folder_id,'mime_type',m.mime_type,'file_size',m.file_size),'targets',targets);
end $$;

-- 7. Atomic attachment: one private asset per draft (path client/publication/asset), linked to the mono-platform
-- variant of its current revision, and one media use per draft. All drafts or none. Idempotent for its attempt.
create function public.publication_agent_v2_media_attach(p_run_id uuid,p_attempt integer,p_original_hash text,p_assets jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;p public.publications;item jsonb;variant uuid;asset uuid;seen uuid[]:=array[]::uuid[];assets uuid[]:=array[]::uuid[];
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_attempt is null or p_attempt<1
  or p_original_hash is null or p_original_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_assets) is distinct from 'array' then
  raise exception 'Invalid media attachment' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status='attached' and r.media_attempts=p_attempt then
  return jsonb_build_object('run_id',r.id,'media_status','attached','publication_ids',to_jsonb(r.publication_ids),'replayed',true); end if;
 if r.media_status<>'pending' or r.media_attempts<>p_attempt then raise exception 'Stale media attempt' using errcode='40001'; end if;
 select * into m from public.publication_drive_media where id=r.selected_media_id and client_id=r.client_id for update;
 if not publications_private.agent_v2_media_available(r,m) or m.claimed_agent_v2_run_id is distinct from r.id
  or (m.file_hash is not null and m.file_hash<>p_original_hash) then raise exception 'Media unavailable' using errcode='23514'; end if;
 if jsonb_array_length(p_assets)<>cardinality(r.publication_ids) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assets) order by value->>'publication_id' loop
  if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k)
    is distinct from array['asset_id','file_hash','height','mime_type','publication_id','storage_path','width']
   or jsonb_typeof(item->'publication_id') is distinct from 'string' or jsonb_typeof(item->'asset_id') is distinct from 'string'
   or jsonb_typeof(item->'width') is distinct from 'number' or jsonb_typeof(item->'height') is distinct from 'number' then
   raise exception 'Invalid media attachment' using errcode='22023'; end if;
  select * into p from public.publications where id=(item->>'publication_id')::uuid for update;
  if p.id is null or p.id=any(seen) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
  seen:=seen||p.id;variant:=publications_private.agent_v2_media_target(r,p);asset:=(item->>'asset_id')::uuid;
  if variant is null then raise exception 'Media target unavailable' using errcode='23514'; end if;
  if item->>'storage_path' is distinct from p.client_id::text||'/'||p.id::text||'/'||asset::text then raise exception 'Invalid media path' using errcode='23514'; end if;
  insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
  values(asset,p.client_id,item->>'storage_path',item->>'file_hash',item->>'mime_type',(item->>'width')::integer,(item->>'height')::integer,'Photo client (Drive) — Agent Publications v2',true);
  insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
  values(variant,asset,p.client_id,coalesce((select max(sort_order)+1 from public.publication_variant_assets where variant_id=variant),0));
  insert into public.publication_media_uses(media_id,asset_id,publication_id,revision_id,client_id,platform) values(m.id,asset,p.id,p.current_revision_id,p.client_id,p.platform);
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.media_attached',p.client_id,'publication',p.id,
   jsonb_build_object('run_id',r.id,'media_id',m.id,'asset_id',asset,'revision_id',p.current_revision_id,'platform',p.platform));
  assets:=assets||asset;
 end loop;
 if cardinality(seen)<>cardinality(r.publication_ids) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
 update public.publication_drive_media set file_hash=coalesce(file_hash,p_original_hash),claimed_agent_v2_run_id=null where id=m.id;
 update public.publication_agent_v2_runs set media_status='attached',media_attached_at=now(),media_lease_until=null,media_error_code=null where id=r.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_attached',r.client_id,'project',r.project_id,
  jsonb_build_object('run_id',r.id,'media_id',m.id,'attempt',p_attempt,'publication_ids',to_jsonb(r.publication_ids)));
 return jsonb_build_object('run_id',r.id,'media_status','attached','publication_ids',to_jsonb(r.publication_ids),'asset_ids',to_jsonb(assets),'replayed',false);
end $$;

-- 8. Failure of a media attempt: drafts kept, media NOT attached, reservation released, explicit needs_media.
-- Idempotent once the run is needs_media or attached; a stale attempt can never overwrite a newer one.
create function public.publication_agent_v2_media_fail(p_run_id uuid,p_attempt integer,p_error_code text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_attempt is null or p_attempt<0
  or p_error_code is null or p_error_code not in('media_unavailable','fetch_failed','invalid_media','upload_failed','attach_failed') then
  raise exception 'Invalid media failure' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status in('attached','needs_media') then return jsonb_build_object('run_id',r.id,'media_status',r.media_status); end if;
 if r.media_attempts<>p_attempt then raise exception 'Stale media attempt' using errcode='40001'; end if;
 update public.publication_agent_v2_runs set media_status='needs_media',media_error_code=p_error_code,media_lease_until=null where id=r.id;
 update public.publication_drive_media set claimed_agent_v2_run_id=null where id=r.selected_media_id and claimed_agent_v2_run_id=r.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_failed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'attempt',p_attempt,'code',p_error_code));
 return jsonb_build_object('run_id',r.id,'media_status','needs_media');
end $$;

revoke all on function publications_private.platform_requires_media(text),publications_private.check_media_before_approval(),
 publications_private.agent_v2_media_available(public.publication_agent_v2_runs,public.publication_drive_media),
 publications_private.agent_v2_media_target(public.publication_agent_v2_runs,public.publications) from public,anon,authenticated,service_role;
grant execute on function publications_private.platform_requires_media(text),publications_private.check_media_before_approval(),
 publications_private.agent_v2_media_available(public.publication_agent_v2_runs,public.publication_drive_media),
 publications_private.agent_v2_media_target(public.publication_agent_v2_runs,public.publications) to service_role;
revoke all on function public.publication_agent_v2_media_claim(uuid,text),public.publication_agent_v2_media_attach(uuid,integer,text,jsonb,text),
 public.publication_agent_v2_media_fail(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.publication_agent_v2_media_claim(uuid,text),public.publication_agent_v2_media_attach(uuid,integer,text,jsonb,text),
 public.publication_agent_v2_media_fail(uuid,integer,text,text) to service_role;
