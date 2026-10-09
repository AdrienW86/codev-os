-- Synthetic PostgreSQL local test only (Lot 4.3 P8). Never execute on a remote project.
-- Runs after publications-agent-v2-media-before.sql (P7 state) and the P8 migration.
-- Assets built for a claimed attempt: deterministic ids, path client/publication/asset, fake derivative hashes.
create function pg_temp.p8_assets(p_claim jsonb,p_salt text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('publication_id',t->>'publication_id','asset_id',md5(p_salt||(t->>'publication_id'))::uuid,
  'storage_path',(p_claim->>'client_id')||'/'||(t->>'publication_id')||'/'||md5(p_salt||(t->>'publication_id'))::uuid,
  'file_hash',md5(p_salt)||md5(p_salt),'mime_type','image/jpeg','width',case when t->>'platform'='google_business_profile' then 1200 else 1080 end,
  'height',case when t->>'platform'='google_business_profile' then 900 else 1080 end) order by t->>'publication_id')
 from jsonb_array_elements(p_claim->'targets') t $$;
create function pg_temp.p8_hash(p_salt text) returns text language sql as $$ select md5('original'||p_salt)||md5(p_salt||'original') $$;
create function pg_temp.p8_pubs(p_run text) returns uuid[] language sql as $$
 select array_agg(x order by x) from unnest((select publication_ids from public.publication_agent_v2_runs where id=(select id from p8_ids where name=p_run))) x $$;
-- SQLSTATE and message of a refused statement (to tell the media invariant from the other approval checks).
create function pg_temp.p8_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
grant execute on function pg_temp.p8_assets(jsonb,text),pg_temp.p8_hash(text),pg_temp.p8_pubs(text),pg_temp.p8_error(text) to service_role;

-- 1. Grants, function properties, browser denial.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_agent_v2_media_claim(uuid,text)','public.publication_agent_v2_media_attach(uuid,integer,text,jsonb,text)',
  'public.publication_agent_v2_media_fail(uuid,integer,text,text)','public.publication_agent_v2_finish(uuid,jsonb,uuid,jsonb,text)',
  'public.publication_ai_claim_media(uuid,uuid,text,jsonb)','publications_private.platform_requires_media(text)','publications_private.check_media_before_approval()',
  'publications_private.agent_v2_media_available(public.publication_agent_v2_runs,public.publication_drive_media)',
  'publications_private.agent_v2_media_target(public.publication_agent_v2_runs,public.publications)','publications_private.guard_agent_v2_run()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_agent_v2_runs','SELECT,INSERT,UPDATE,DELETE')
   and not has_table_privilege(r,'public.publication_drive_media','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege(r,'public.publication_media_uses','SELECT,INSERT,UPDATE,DELETE'),'browser table privileges absent '||r);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_agent_v2_runs','DELETE') and not has_table_privilege('service_role','public.publication_agent_v2_runs','TRUNCATE'),'runs never deleted by the server');
 perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_agent_v2_runs'::regclass)
  and (select relrowsecurity from pg_class where oid='public.publication_drive_media'::regclass) and (select relrowsecurity from pg_class where oid='public.publication_media_uses'::regclass),'RLS kept');
 perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename in('publication_agent_v2_runs','publication_drive_media','publication_media_uses')),'no browser policy');
 perform pg_temp.replay_assert(pg_get_functiondef('public.publication_ai_claim_media(uuid,uuid,text,jsonb)'::regprocedure) like '%m.claimed_agent_v2_run_id is not null%','Agent v1 refuses a media reserved by Agent v2');
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_agent_v2_media_claim(null,''user_local'')','42501','anon RPC denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_agent_v2_media_attach(null,1,null,null,''user_local'')','42501','authenticated RPC denied');
select pg_temp.replay_failure('select * from public.publication_media_uses','42501','authenticated read denied');
reset role;

-- 2. Additive migration, legacy compatibility.
select pg_temp.replay_assert((select v->'publications' from p8_before)=(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),'publications unchanged by the migration');
select pg_temp.replay_assert((select v->'media' from p8_before)=(select coalesce(jsonb_agg(to_jsonb(m)-'claimed_agent_v2_run_id' order by m.id),'[]') from public.publication_drive_media m)
 and not exists(select 1 from public.publication_drive_media where claimed_agent_v2_run_id is not null),'drive media unchanged, no reservation');
select pg_temp.replay_assert((select (v->>'assets')::bigint=(select count(*) from public.publication_assets) and (v->>'uses')::bigint=(select count(*) from public.publication_media_uses)
 and (v->>'events')::bigint=(select count(*) from public.publication_events) from p8_before),'no asset, use or event created by the migration');
select pg_temp.replay_assert((select status='completed' and media_status='needs_media' and media_error_code='not_attached' and media_attempts=0 and media_attached_at is null
 from public.publication_agent_v2_runs where id=(select id from p8_ids where name='legacy_run')),'P7 run with a never-attached media: explicit needs_media');
select pg_temp.replay_assert(not exists(select 1 from public.publication_agent_v2_runs where status<>'completed' and media_status<>'none'),'other runs: no media step');
select pg_temp.replay_assert((select status='approved' from public.publications where id=(select id from p8_ids where name='legacy_approved'))
 and not exists(select 1 from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.publication_id=(select id from p8_ids where name='legacy_approved')),
 'legacy approval without media kept as is');
select pg_temp.replay_assert(publications_private.platform_requires_media('facebook') and publications_private.platform_requires_media('instagram')
 and publications_private.platform_requires_media('google_business_profile') and not publications_private.platform_requires_media('tiktok') and not publications_private.platform_requires_media(null),
 'media capability: required on every platform (kept product rule), unknown platform false');

-- 3. Approval invariant (SQL), whatever the platform; valid asset = same client, confirmed rights.
set local role service_role;
do $$declare pl text;r jsonb;pub uuid;rev uuid;v uuid;cl uuid:=(select id from p8_ids where name='client');asset uuid;begin
 foreach pl in array array['facebook','instagram','google_business_profile'] loop
  r:=public.publication_create_from_occurrence(pg_temp.p8_occ(pl),null,null,'Manuel '||pl,'Texte manuel '||pl,null,'user_local');pub:=(r->>'publication_id')::uuid;rev:=(r->>'revision_id')::uuid;
  perform public.publication_submit_manual(pub,rev,'user_local');
  perform pg_temp.replay_assert(pg_temp.p8_error(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,rev))='23514:Media required before approval','approval without media refused: '||pl);
  perform pg_temp.replay_assert((select status='pending_review' from public.publications where id=pub) and not exists(select 1 from public.publication_reviews where publication_id=pub),'refused approval left nothing: '||pl);
  perform public.publication_review_manual(pub,rev,'rejected','Photo manquante','user_local');
  perform pg_temp.replay_assert((select status='rejected' from public.publications where id=pub),'rejection never needs a media: '||pl);
 end loop;
 r:=public.publication_create_from_occurrence(pg_temp.p8_occ('instagram'),null,null,'Manuel IG','Texte IG',null,'user_local');pub:=(r->>'publication_id')::uuid;rev:=(r->>'revision_id')::uuid;
 insert into p8_ids values('manual_ig',pub);
 select id into v from public.publication_variants where revision_id=rev;asset:=gen_random_uuid();
 reset role;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed) values(asset,cl,cl::text||'/'||pub::text||'/'||asset::text,repeat('d',64),'image/jpeg','Sans droits',false);
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(v,asset,cl,0);
 set local role service_role;
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,rev),'23514','asset without confirmed rights is not a valid media');
 reset role;
 perform pg_temp.replay_assert(pg_temp.p8_error(format('update public.publications set status=''approved'' where id=%L',pub))='23514:Media required before approval','direct status update cannot bypass the invariant');
 asset:=gen_random_uuid();
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed) values(asset,cl,cl::text||'/'||pub::text||'/'||asset::text,repeat('e',64),'image/jpeg','Client',true);
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(v,asset,cl,1);
 set local role service_role;
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=pub),'approval with a valid media accepted');
end $$;
reset role;

-- 4. Full batch FB + IG + GBP with media: reservation at finish, claim, strict attach, idempotent replay.
set local role service_role;
do $$
declare run uuid;c jsonb;a jsonb;r jsonb;m uuid:=(select id from p8_ids where name='m_full');cl uuid:=(select id from p8_ids where name='client');pubs uuid[];other uuid;
 h text:=pg_temp.p8_hash('full');n_assets bigint;n_links bigint;pub uuid;rev uuid;
begin
 run:=pg_temp.p8_run('m_full',array['facebook','instagram','google_business_profile']);insert into p8_ids values('run_full',run);pubs:=pg_temp.p8_pubs('run_full');
 perform pg_temp.replay_assert((select status='completed' and media_status='pending' and media_attempts=0 and media_lease_until is null and selected_media_id=m from public.publication_agent_v2_runs where id=run)
  and (select claimed_agent_v2_run_id=run and claimed_run_id is null from public.publication_drive_media where id=m),'finish reserves the media (pending)');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_media_uses where media_id=m) and not exists(select 1 from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.publication_id=any(pubs)),
  'drafts created without any link yet');
 -- The reserved media cannot be suggested to another run.
 other:=(public.publication_agent_v2_begin((select id from p8_ids where name='social'),array[pg_temp.p8_occ('facebook')],1,'user_local')->>'run_id')::uuid;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,''{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}'',''user_local'')',other,
  jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',pg_temp.p8_occ('facebook'),'text','T','cta',null))),m),'22023','reserved media refused to another run');
 perform public.publication_agent_v2_fail(other,'invalid_output','{"estimated_cost_eur":0}','user_local');
 -- No approval while the media is pending.
 select id,current_revision_id into pub,rev from public.publications where id=pubs[1];
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,rev),'23514','no approval while the media is not attached');
 -- Claim: server-side descriptor and targets, one attempt at a time.
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''admin'')',run),'22023','invalid actor');
 c:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_assert((c->>'attempt')::integer=1 and c->>'media_status'='pending' and (c->>'client_id')::uuid=cl and jsonb_array_length(c->'targets')=3
  and c->'media'->>'id'=m::text and c->'media'->>'drive_folder_id'='folder00000001','claim returns the server-side descriptor');
 perform pg_temp.replay_assert((select bool_and(p.platform=t->>'platform' and p.current_revision_id=(t->>'revision_id')::uuid and v.revision_id=p.current_revision_id and v.platform=p.platform)
  from jsonb_array_elements(c->'targets') t join public.publications p on p.id=(t->>'publication_id')::uuid join public.publication_variants v on v.id=(t->>'variant_id')::uuid),'targets: current revision, mono-platform variant');
 perform pg_temp.replay_assert((select media_lease_until>now() and media_attempts=1 from public.publication_agent_v2_runs where id=run),'attempt leased');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run),'55P03','concurrent attempt refused');
 a:=pg_temp.p8_assets(c,'full');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,2,%L,%L,''user_local'')',run,h,a),'40001','unknown attempt refused');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,'xyz',a),'22023','invalid original hash');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,a-0),'22023','one draft missing');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,jsonb_set(a,'{0,extra}','1')),'22023','unexpected key');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,jsonb_set(a,'{1,publication_id}',a->0->'publication_id')),'22023','duplicate draft');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,jsonb_set(a,'{0,storage_path}',to_jsonb('../'||(a->0->>'storage_path')))),'23514','tampered storage path');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,jsonb_set(a,'{0,publication_id}',to_jsonb((select id from p8_ids where name='manual_ig')))),'23514','draft outside the run refused');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,h,jsonb_set(a,'{0,mime_type}','"image/gif"')),'23514','unsupported mime refused by the asset constraint');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_media_uses where media_id=m) and (select media_status='pending' from public.publication_agent_v2_runs where id=run),'refused attachments left nothing');
 select count(*) into n_assets from public.publication_assets;select count(*) into n_links from public.publication_variant_assets;
 r:=public.publication_agent_v2_media_attach(run,1,h,a,'user_local');
 perform pg_temp.replay_assert(r->>'media_status'='attached' and r->>'replayed'='false' and jsonb_array_length(r->'asset_ids')=3,'attached');
 perform pg_temp.replay_assert((select count(*) from public.publication_assets)=n_assets+3 and (select count(*) from public.publication_variant_assets)=n_links+3,'three private assets, three variant links');
 perform pg_temp.replay_assert((select count(*) from public.publication_media_uses u join public.publications p on p.id=u.publication_id
  where u.media_id=m and u.publication_id=any(pubs) and u.revision_id=p.current_revision_id and u.platform=p.platform and u.client_id=cl)=3,'one use per draft / platform on the current revision');
 perform pg_temp.replay_assert((select count(*) from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id join public.publications p on p.id=v.publication_id
  join public.publication_assets x on x.id=va.asset_id where p.id=any(pubs) and v.revision_id=p.current_revision_id and v.platform=p.platform
   and x.storage_path=cl::text||'/'||p.id::text||'/'||x.id::text and x.rights_confirmed and x.client_id=cl)=3,'each asset on its own draft path, linked to its mono-platform variant');
 perform pg_temp.replay_assert((select media_status='attached' and media_attached_at is not null and media_lease_until is null and media_error_code is null from public.publication_agent_v2_runs where id=run)
  and (select claimed_agent_v2_run_id is null and file_hash=h from public.publication_drive_media where id=m),'run attached, reservation released, original hash recorded');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.media_attached' and metadata->>'run_id'=run::text)=3
  and exists(select 1 from public.publication_events where action='publication.agent_v2_media_attached' and metadata->>'run_id'=run::text),'attachment audited');
 -- Idempotence: replay of the same attempt, claim / fail after attachment.
 r:=public.publication_agent_v2_media_attach(run,1,h,a,'user_local');
 perform pg_temp.replay_assert(r->>'replayed'='true' and (select count(*) from public.publication_assets)=n_assets+3 and (select count(*) from public.publication_media_uses where media_id=m)=3,'replay: no duplicate');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_claim(run,'user_local')->>'media_status'='attached' and public.publication_agent_v2_media_fail(run,1,'upload_failed','user_local')->>'media_status'='attached'
  and (select media_attempts=1 from public.publication_agent_v2_runs where id=run),'attached is final: no new attempt, no failure overwrite');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,2,%L,%L,''user_local'')',run,h,a),'40001','other attempt after attachment refused');
 -- Approval now possible.
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=pub),'approval with the attached media');
 -- The consumed media cannot be suggested again.
 other:=(public.publication_agent_v2_begin((select id from p8_ids where name='social'),array[pg_temp.p8_occ('facebook')],1,'user_local')->>'run_id')::uuid;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,''{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}'',''user_local'')',other,
  jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',pg_temp.p8_occ('facebook'),'text','T','cta',null))),m),'22023','used media refused');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,''{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}'',''user_local'')',other,
  jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',pg_temp.p8_occ('facebook'),'text','T','cta',null))),(select id from p8_ids where name='m_folder')),'22023','media outside the configured folder refused');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,''{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}'',''user_local'')',other,
  jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',pg_temp.p8_occ('facebook'),'text','T','cta',null))),(select id from p8_ids where name='m_other')),'22023','media of another client refused');
 perform public.publication_agent_v2_fail(other,'invalid_output','{"estimated_cost_eur":0}','user_local');
 -- A run without media: no media step at all.
 run:=pg_temp.p8_run(null,array['google_business_profile']);insert into p8_ids values('run_nomedia',run);
 perform pg_temp.replay_assert((select status='completed' and media_status='none' and selected_media_id is null from public.publication_agent_v2_runs where id=run),'no media: media_status none');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run),'55000','no media step to claim');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_fail(%L,0,''fetch_failed'',''user_local'')',run),'55000','no media step to fail');
end $$;
reset role;
-- One use per media / publication / platform (DB constraint), attached state final.
do $$declare run uuid:=(select id from p8_ids where name='run_full');u public.publication_media_uses;asset uuid:=gen_random_uuid();begin
 select * into u from public.publication_media_uses where media_id=(select id from p8_ids where name='m_full') limit 1;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed) values(asset,u.client_id,u.client_id::text||'/'||u.publication_id::text||'/'||asset::text,repeat('f',64),'image/jpeg','Doublon',true);
 perform pg_temp.replay_failure(format('insert into public.publication_media_uses(media_id,asset_id,publication_id,revision_id,client_id,platform) values(%L,%L,%L,%L,%L,%L)',
  u.media_id,asset,u.publication_id,u.revision_id,u.client_id,u.platform),'23505','second use of the same media on the same draft / platform refused');
 perform pg_temp.replay_failure(format('update public.publication_agent_v2_runs set media_status=''pending'',media_attached_at=null where id=%L',run),'55000','attached run cannot go back');
 perform pg_temp.replay_failure(format('update public.publication_agent_v2_runs set estimated_cost_eur=0 where id=%L',run),'55000','generation fields still immutable');
 perform pg_temp.replay_failure(format('update public.publication_agent_v2_runs set media_status=''pending'' where id=%L',(select id from p8_ids where name='run_nomedia')),'55000','run without media never gets a media step');
end $$;

-- 5. Failure, explicit needs_media, stale attempts, expired lease, retry without any generation.
set local role service_role;
do $$
declare run uuid;c jsonb;c2 jsonb;m uuid:=(select id from p8_ids where name='m_fail');pubs uuid[];pub uuid;rev uuid;h text:=pg_temp.p8_hash('fail');tokens integer;
begin
 run:=pg_temp.p8_run('m_fail',array['facebook','instagram']);pubs:=(select array_agg(x order by x) from unnest((select publication_ids from public.publication_agent_v2_runs where id=run)) x);
 select input_tokens into tokens from public.publication_agent_v2_runs where id=run;
 c:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_fail(%L,1,''unknown'',''user_local'')',run),'22023','unknown media failure code');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_fail(%L,0,''fetch_failed'',''user_local'')',run),'40001','stale attempt cannot fail the current one');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_fail(run,1,'fetch_failed','user_local')->>'media_status'='needs_media','fetch failure: needs_media');
 perform pg_temp.replay_assert((select status='completed' and media_status='needs_media' and media_error_code='fetch_failed' and media_lease_until is null from public.publication_agent_v2_runs where id=run)
  and (select claimed_agent_v2_run_id is null and file_hash is null from public.publication_drive_media where id=m) and not exists(select 1 from public.publication_media_uses where media_id=m)
  and (select count(*) from public.publications where id=any(pubs) and status='draft')=2,'drafts kept, media neither used nor reserved');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.agent_v2_media_failed' and metadata=jsonb_build_object('run_id',run,'attempt',1,'code','fetch_failed')),'failure audited');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_fail(run,1,'upload_failed','user_local')->>'media_status'='needs_media'
  and (select media_error_code='fetch_failed' from public.publication_agent_v2_runs where id=run),'failure idempotent, first cause kept');
 select id,current_revision_id into pub,rev from public.publications where id=pubs[1];
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,rev),'23514','needs_media: approval impossible');
 -- Retry: new attempt; an expired attempt is superseded and can no longer attach.
 c:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_assert((c->>'attempt')::integer=2 and (select claimed_agent_v2_run_id=run from public.publication_drive_media where id=m),'retry re-reserves the media (attempt 2)');
 reset role;update public.publication_agent_v2_runs set media_lease_until=now()-interval '1 second' where id=run;set local role service_role;
 c2:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_assert((c2->>'attempt')::integer=3,'expired attempt superseded (attempt 3)');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,2,%L,%L,''user_local'')',run,h,pg_temp.p8_assets(c,'fail2')),'40001','superseded attempt cannot attach');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_fail(%L,2,''upload_failed'',''user_local'')',run),'40001','superseded attempt cannot fail the current one');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_attach(run,3,h,pg_temp.p8_assets(c2,'fail3'),'user_local')->>'media_status'='attached','retry attached');
 perform pg_temp.replay_assert((select count(*) from public.publication_media_uses where media_id=m)=2 and (select input_tokens=tokens and media_attempts=3 from public.publication_agent_v2_runs where id=run),'one use per draft, generation untouched');
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=pub),'approved once the retry attached the media');
end $$;

-- 6. Unavailable media, archived or reviewed targets: refused, nothing written.
do $$
declare run uuid;c jsonb;m uuid;pubs uuid[];n_assets bigint;n_uses bigint;pub uuid;rev uuid;
begin
 -- Media made unusable after the reservation.
 run:=pg_temp.p8_run('m_unusable',array['google_business_profile']);m:=(select id from p8_ids where name='m_unusable');
 reset role;update public.publication_drive_media set analysis='{"scene":"roof","usable":false}' where id=m;set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run),'23514','unusable media refused at claim');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_fail(run,0,'media_unavailable','user_local')->>'media_status'='needs_media','first attempt refused before any I/O: needs_media');
 perform pg_temp.replay_assert((select claimed_agent_v2_run_id is null from public.publication_drive_media where id=m),'reservation released');
 -- Draft archived between claim and attach.
 run:=pg_temp.p8_run('m_archive',array['facebook','instagram']);m:=(select id from p8_ids where name='m_archive');
 pubs:=(select array_agg(x order by x) from unnest((select publication_ids from public.publication_agent_v2_runs where id=run)) x);
 c:=public.publication_agent_v2_media_claim(run,'user_local');
 perform public.publication_archive(pubs[1],'user_local');
 select count(*) into n_assets from public.publication_assets;select count(*) into n_uses from public.publication_media_uses;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,pg_temp.p8_hash('archive'),pg_temp.p8_assets(c,'archive')),'23514','archived draft: whole attachment refused');
 perform pg_temp.replay_assert((select count(*) from public.publication_assets)=n_assets and (select count(*) from public.publication_media_uses)=n_uses
  and not exists(select 1 from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.publication_id=any(pubs)),'no partial attachment to the sister draft');
 perform public.publication_agent_v2_media_fail(run,1,'attach_failed','user_local');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run),'23514','retry refused while a target is archived');
 perform pg_temp.replay_assert((select media_status='needs_media' and media_error_code='attach_failed' from public.publication_agent_v2_runs where id=run),'archived target: stays needs_media');
 -- Reviewed (rejected) draft: its revision is frozen, never attached.
 run:=pg_temp.p8_run('m_reject',array['google_business_profile']);
 select id,current_revision_id into pub,rev from public.publications where id=(select publication_ids[1] from public.publication_agent_v2_runs where id=run);
 perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'rejected','Refus','user_local');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run),'23514','reviewed draft refused');
 perform public.publication_agent_v2_media_fail(run,0,'media_unavailable','user_local');
 -- Archived draft: no direct link either (P5 / P7 guards still hold).
 reset role;
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values((select id from public.publication_variants where publication_id=%L limit 1),%L,%L,5)',
  pubs[1],(select asset_id from public.publication_media_uses limit 1),(select id from p8_ids where name='client')),'55000','no link on an archived draft');
 set local role service_role;
end $$;
reset role;

-- 7. Atomicity: failure injected after every write of the attachment.
create schema p8_test_injection;
create function p8_test_injection.fail_attach() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after attachment writes' using errcode='P0001'; end $$;
grant usage on schema p8_test_injection to service_role;grant execute on function p8_test_injection.fail_attach() to service_role;
create trigger p8_inject before insert on public.publication_events for each row when (new.action='publication.agent_v2_media_attached') execute function p8_test_injection.fail_attach();
set local role service_role;
do $$declare run uuid;c jsonb;m uuid:=(select id from p8_ids where name='m_inject');n_assets bigint;n_links bigint;begin
 run:=pg_temp.p8_run('m_inject',array['facebook','instagram']);insert into p8_ids values('run_inject',run);c:=public.publication_agent_v2_media_claim(run,'user_local');
 select count(*) into n_assets from public.publication_assets;select count(*) into n_links from public.publication_variant_assets;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_media_attach(%L,1,%L,%L,''user_local'')',run,pg_temp.p8_hash('inject'),pg_temp.p8_assets(c,'inject')),'P0001','injected failure');
 perform pg_temp.replay_assert((select count(*) from public.publication_assets)=n_assets and (select count(*) from public.publication_variant_assets)=n_links
  and not exists(select 1 from public.publication_media_uses where media_id=m) and (select media_status='pending' and media_attempts=1 from public.publication_agent_v2_runs where id=run)
  and (select claimed_agent_v2_run_id=run and file_hash is null from public.publication_drive_media where id=m),'no half attachment: nothing persisted, attempt still open');
end $$;
reset role;
drop trigger p8_inject on public.publication_events;
drop schema p8_test_injection cascade;
set local role service_role;
do $$declare run uuid:=(select id from p8_ids where name='run_inject');begin
 perform pg_temp.replay_assert(public.publication_agent_v2_media_attach(run,1,pg_temp.p8_hash('inject'),pg_temp.p8_assets(jsonb_build_object('client_id',(select id from p8_ids where name='client'),
  'targets',(select jsonb_agg(jsonb_build_object('publication_id',x,'platform',(select platform from public.publications where id=x))) from unnest((select publication_ids from public.publication_agent_v2_runs where id=run)) x)),'inject'),'user_local')->>'media_status'='attached',
  'same attempt retried after the failure: attached');
end $$;
reset role;

-- 8. Audit and safety.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where (action like 'publication.agent_v2_media%' or action='publication.media_attached')
 and (coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(file0|folder0|drive|storage|path|token|secret|credential|https?:)'),'media audit without Drive id, folder, path or secret');
select pg_temp.replay_assert(not exists(select 1 from public.publication_assets where storage_path ~ '(://|\.\.|^/|token|sig=)'),'private relative paths only, no URL or token stored');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no delivery, no job');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_drive_media m where m.claimed_agent_v2_run_id is not null and exists(select 1 from public.publication_media_uses u where u.media_id=m.id)),
 'a used media is never still reserved');
