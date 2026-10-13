-- Synthetic PostgreSQL local test only (socle Publications, lot 7 : « Reprogrammer »). Never execute remotely.
-- Appended after publications-delivery-engine.sql on the full migration chain (same transaction, rolled back).
reset role;
create function pg_temp.sv_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.sv_error(text) to service_role;
-- 1. Grants: server only, invoker, fixed search_path.
do $$declare r text;f text:='public.publication_reschedule(uuid,uuid,uuid,text)';begin
 foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||r);end loop;
 perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server may reschedule');
 perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker reschedule');
end $$;

-- 2. Approved publication with a prepared delivery: delivery and job cancelled, new publication on the chosen slot,
-- same text and media, approval reset (« À valider »), old one archived and linked by the journal.
do $$declare pub uuid;rev uuid;target uuid;r jsonb;d jsonb;np uuid;nrev uuid;old_occ uuid;begin
 update public.publication_settings set emergency_stop=false,publishing_enabled=true;
 pub:=pg_temp.p10_publication('facebook','Lot 7 approuvée');select current_revision_id,occurrence_id into rev,old_occ from public.publications where id=pub;
 target:=pg_temp.p10_occ('facebook');
 set local role service_role;
 d:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert(d->>'created'='true','delivery prepared before rescheduling');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,gen_random_uuid(),target,'user_local'))='40001','stale revision refused');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,old_occ,'user_local'))='23514','same slot refused');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,pg_temp.p10_occ('instagram'),'user_local'))='23514','other platform refused');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,target,'agent'))='22023','non-human actor refused');
 r:=public.publication_reschedule(pub,rev,target,'user_local');
 np:=(r->>'publication_id')::uuid;nrev:=(r->>'revision_id')::uuid;
 reset role;
 perform pg_temp.replay_assert(r->>'status'='pending_review' and (r->>'archived_source_id')::uuid=pub,'approved → à valider again');
 perform pg_temp.replay_assert((select status='cancelled' from public.publication_deliveries where id=(d->>'delivery_id')::uuid)
  and not exists(select 1 from public.publication_jobs where delivery_id=(d->>'delivery_id')::uuid and status in('pending','processing')),'prepared delivery and job cancelled');
 perform pg_temp.replay_assert((select archived_at is not null and occurrence_id=old_occ from public.publications where id=pub),'old publication archived, its slot binding unchanged');
 perform pg_temp.replay_assert((select occurrence_id=target and status='pending_review' and current_revision_id=nrev and platform='facebook' from public.publications where id=np)
  and (select publication_id=np from public.publication_channel_occurrences where id=target),'new publication bound to the chosen slot');
 perform pg_temp.replay_assert((select text_content from public.publication_variants where revision_id=nrev)='Lot 7 approuvée','same text');
 perform pg_temp.replay_assert((select array_agg(asset_id order by sort_order) from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=nrev)
  =(select array_agg(asset_id order by sort_order) from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=rev),'same media');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_reviews where revision_id=nrev),'approval reset: no review on the new revision');
 perform pg_temp.replay_assert((select count(*) from public.admin_notifications where event_key='publication-review:'||np::text
  and category='publication_review' and href='/publications/review')=1,'« À valider » notification for the new publication');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.rescheduled' and resource_id=pub
  and metadata->>'publication_id'=np::text and metadata->>'approval_reset'='true')=1,'rescheduling journaled');
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_prepare_delivery(%L,%L)',np,'user_local'))='55000','not delivered before a new human approval');
 perform public.publication_review_manual(np,nrev,'approved',null,'user_local');
 d:=public.publication_prepare_delivery(np,'user_local');
 perform pg_temp.replay_assert(d->>'created'='true','new approval → new delivery at the new slot');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,pg_temp.p10_occ('facebook'),'user_local'))='55000','archived source never rescheduled again');
 reset role;
 perform pg_temp.replay_assert((select scheduled_for from public.publication_deliveries where id=(d->>'delivery_id')::uuid)=(select scheduled_for from public.publication_channel_occurrences where id=target),'delivery time = new slot');
end $$;

-- 3. Draft stays draft; a refused publication and a taken slot are refused.
do $$declare pub uuid;rev uuid;target uuid;r jsonb;refused uuid;rrev uuid;taken uuid;begin
 pub:=pg_temp.p10_publication('instagram','Lot 7 brouillon',false);select current_revision_id into rev from public.publications where id=pub;
 refused:=pg_temp.p10_publication('instagram','Lot 7 refusée',false);select current_revision_id into rrev from public.publications where id=refused;
 select occurrence_id into taken from public.publications where id=refused;
 target:=pg_temp.p10_occ('instagram');
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,taken,'user_local'))='23505','slot already taken refused');
 r:=public.publication_reschedule(pub,rev,target,'user_local');
 perform pg_temp.replay_assert(r->>'status'='draft' and (select status from public.publications where id=(r->>'publication_id')::uuid)='draft','draft stays draft');
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications where event_key='publication-review:'||(r->>'publication_id')),'a draft is not announced « À valider »');
 perform public.publication_submit_manual(refused,rrev,'user_local');perform public.publication_review_manual(refused,rrev,'rejected','Hors sujet','user_local');
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',refused,rrev,pg_temp.p10_occ('instagram'),'user_local'))='55000','refused never rescheduled');
 reset role;
end $$;

-- 4. A delivery that may have reached the provider (uncertain) blocks the rescheduling.
do $$declare pub record;target uuid;begin
 select p.id,p.current_revision_id,p.platform into pub from public.publications p join public.publication_deliveries d on d.publication_id=p.id
  where d.status='uncertain' and p.archived_at is null and p.status in('draft','pending_review','approved') limit 1;
 perform pg_temp.replay_assert(pub.id is not null,'fixture: a publication with an uncertain delivery');
 target:=pg_temp.p10_occ(pub.platform);
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub.id,pub.current_revision_id,target,'user_local'))='55000','uncertain delivery blocks rescheduling');
 reset role;
end $$;

-- 5. Photo of the client library: refused once it is no longer publishable (nothing changed); otherwise the photo
-- history follows the new publication.
do $$declare pub uuid;rev uuid;cl uuid;pa uuid;lib uuid:=gen_random_uuid();target uuid;r jsonb;np uuid;begin
 pub:=pg_temp.p10_publication('google_business_profile','Lot 7 photothèque');
 select current_revision_id,client_id into rev,cl from public.publications where id=pub;
 select va.asset_id into pa from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=rev;
 insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,library_status,status_changed_by,origin)
 values(lib,cl,'folder_sv',repeat('e',64),repeat('e',32),'drive_file_sv','image/jpeg',4096,'image',now(),'used','user_local','whatsapp');
 insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,publication_asset_id,used_by) values(lib,cl,pub,'google_business_profile',pa,'user_local');
 target:=pg_temp.p10_occ('google_business_profile');
 update public.whatsapp_assets set library_status='rejected' where id=lib;
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,target,'user_local'))='23514','library photo no longer publishable: refused');
 reset role;
 perform pg_temp.replay_assert((select archived_at is null and status='approved' from public.publications where id=pub)
  and (select publication_id is null from public.publication_channel_occurrences where id=target),'refusal changes nothing');
 update public.whatsapp_assets set library_status='used' where id=lib;
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,manual_verdict)
 values(lib,cl,'to_review',0.5,0.5,'{invoice}',true,'Document.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null);
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sv_error(format('select public.publication_reschedule(%L,%L,%L,%L)',pub,rev,target,'user_local'))='23514','confidential library photo refused');
 reset role;
 delete from public.whatsapp_asset_assessments where asset_id=lib;
 set local role service_role;
 r:=public.publication_reschedule(pub,rev,target,'user_local');np:=(r->>'publication_id')::uuid;
 reset role;
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_asset_uses where asset_id=lib and publication_id=np and platform='google_business_profile' and publication_asset_id=pa)=1
  and (select count(*) from public.whatsapp_asset_uses where asset_id=lib)=2,'photo history follows the new publication, old row kept');
end $$;
