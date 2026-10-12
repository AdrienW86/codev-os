-- Synthetic PostgreSQL local test only (planification d'un brouillon non planifié). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (client "P10 fixture": daily Facebook / Instagram / GBP occurrences
-- for 20 days, assigned accounts, publishing open), every publications migration through P13, then
-- 20261025000000_publications_unscheduled_drafts.sql and 20261026000000_publications_schedule_drafts.sql.
create function pg_temp.sd_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
create temporary table sd_ids(name text primary key,id uuid not null);
grant select,insert on sd_ids to service_role;
grant execute on function pg_temp.sd_error(text) to service_role;
-- Unscheduled draft (PR #33 RPC) whose variants carry one private image each; assets registered as the server does.
create function pg_temp.sd_draft(p_title text,p_platforms text[]) returns uuid language plpgsql as $$
declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');asset uuid:=gen_random_uuid();v jsonb;pub uuid;begin
 reset role;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
 values(asset,cl,cl::text||'/draft/'||asset::text,md5(asset::text)||md5(p_title),'image/jpeg',1080,1080,'WhatsApp client',true);
 select jsonb_agg(jsonb_build_object('platform',p,'text_content','Texte '||p||' '||p_title,'metadata',jsonb_build_object('cta','Appelez-nous'),'asset_ids',jsonb_build_array(asset))) into v from unnest(p_platforms) p;
 set local role service_role;
 pub:=public.publication_save_unscheduled_draft(cl,s,p_title,'Angle '||p_title,'Message client : toiture refaite',v,'user_local');
 insert into sd_ids values(p_title||'_asset',asset);
 return pub;
end $$;
create function pg_temp.sd_assign(p_platform text,p_occurrence uuid) returns jsonb language sql as $$
 select jsonb_build_object('platform',p_platform,'occurrence_id',p_occurrence) $$;
grant execute on function pg_temp.sd_draft(text,text[]),pg_temp.sd_assign(text,uuid) to service_role;

-- 1. Grants and function properties.
do $$declare r text;f text:='public.publication_schedule_draft(uuid,uuid,jsonb,text)';begin
 foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||r);end loop;
 perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function granted');
 perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path');
end $$;

-- 2. Mono-platform draft, approved before scheduling: bound in place, approval reset, photos and text kept.
set local role service_role;
do $$declare pub uuid:=pg_temp.sd_draft('Mono',array['facebook']);rev uuid;occ uuid:=pg_temp.p10_occ('facebook');o public.publication_channel_occurrences;
 r jsonb;p public.publications;occurrences_before integer:=(select count(*) from public.publication_channel_occurrences);bound_before integer;begin
 insert into sd_ids values('mono',pub);
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='approved','unscheduled draft approved first');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub)) is not null and not exists(select 1 from public.publication_deliveries where publication_id=pub),'approved but unscheduled: no delivery');
 select count(*) into bound_before from public.publications where occurrence_id is not null;
 select * into o from public.publication_channel_occurrences where id=occ;
 r:=public.publication_schedule_draft(pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',occ)),'user_local');
 select * into p from public.publications where id=pub;
 perform pg_temp.replay_assert(r->>'mode'='in_place' and (r->'publications'->0->>'publication_id')::uuid=pub,'same publication, bound in place');
 perform pg_temp.replay_assert(p.occurrence_id=occ and p.platform='facebook' and p.target_date=o.local_date and p.slot is null and p.archived_at is null,'occurrence, platform and occurrence date set; no weekly slot taken');
 perform pg_temp.replay_assert((select publication_id from public.publication_channel_occurrences where id=occ)=pub,'occurrence linked to the draft');
 perform pg_temp.replay_assert(p.status='draft' and p.current_revision_id<>rev,'approval reset: new draft revision');
 perform pg_temp.replay_assert((select v.text_content='Texte facebook Mono' and v.metadata->>'cta'='Appelez-nous' from public.publication_variants v where v.revision_id=p.current_revision_id),'variant text and metadata kept');
 perform pg_temp.replay_assert((select array_agg(va.asset_id) from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=p.current_revision_id)=array[(select id from sd_ids where name='Mono_asset')],'photo kept on the new revision');
 perform pg_temp.replay_assert((select internal_title='Mono' and angle='Angle Mono' and source_content='Message client : toiture refaite' and target_date=o.local_date and parent_revision_id=rev from public.publication_revisions where id=p.current_revision_id),'editorial history carried, dated revision');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_reviews where revision_id=rev and decision='approved'),'previous approval kept in history');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=pub and action='publication.scheduled' and (metadata->>'approval_reset')::boolean and metadata->>'previous_status'='approved'),'scheduling audited with approval reset');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_occurrences)=occurrences_before and (select count(*) from public.publications where occurrence_id is not null)=bound_before+1,'no occurrence created, no other publication bound');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_prepare_delivery(%L,''user_local'')',pub))='55000:Publication not approved','old approval not reused for delivery');
 -- New human approval, then the existing delivery engine schedules at the occurrence time.
 perform public.publication_submit_manual(pub,p.current_revision_id,'user_local');perform public.publication_review_manual(pub,p.current_revision_id,'approved',null,'user_local');
 r:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert((select scheduled_for from public.publication_deliveries where id=(r->>'delivery_id')::uuid)=o.scheduled_for,'delivery at the occurrence time');
 -- A content change after approval invalidates it (existing revise path): delivery blocked, job cancelled.
 select * into p from public.publications where id=pub;
 perform public.publication_save_draft(pub,p.current_revision_id,p.client_id,p.project_id,'Mono','Angle Mono','Message client : toiture refaite',o.local_date,null,null,
  jsonb_build_array(jsonb_build_object('platform','facebook','text_content','Texte modifié','asset_ids',jsonb_build_array((select id from sd_ids where name='Mono_asset')))),'user_local');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='draft','content change resets approval');
 perform pg_temp.replay_assert((select status from public.publication_deliveries where id=(r->>'delivery_id')::uuid)='blocked' and not exists(select 1 from public.publication_jobs where delivery_id=(r->>'delivery_id')::uuid and status in('pending','processing')),'prepared delivery blocked, job cancelled');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,(select current_revision_id from public.publications where id=pub),jsonb_build_array(pg_temp.sd_assign('facebook',pg_temp.p10_occ('facebook')))))
  ='55000:Publication already scheduled','a scheduled publication is never moved by this RPC');
end $$;

-- 3. Refusals leave the draft untouched and recoverable.
do $$declare pub uuid:=pg_temp.sd_draft('Refus',array['facebook']);rev uuid;taken uuid:=(select occurrence_id from public.publications where id=(select id from sd_ids where name='mono'));
 free uuid:=pg_temp.p10_occ('facebook');ig uuid:=pg_temp.p10_occ('instagram');skipped uuid;e text;other_cl uuid:=(select id from p10_ids where name='other_client');begin
 insert into sd_ids values('refus',pub);
 select current_revision_id into rev from public.publications where id=pub;
 e:=pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',taken))));
 perform pg_temp.replay_assert(e like '23505:Occurrence already has a publication%','occupied occurrence refused, nothing replaced');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,gen_random_uuid(),jsonb_build_array(pg_temp.sd_assign('facebook',free)))) like '40001:%','stale revision refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',ig)))) like '23514:Invalid occurrence%','occurrence of another platform refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('instagram',ig)))) like '23514:Every draft platform%','platform absent from the draft refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',free),pg_temp.sd_assign('facebook',free)))) like '22023:%','duplicate assignment refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,''[]'',''user_local'')',pub,rev)) like '22023:%','empty assignment refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,'[{"platform":"facebook","occurrence_id":"x"}]')) like '22023:%','malformed occurrence id refused');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''admin'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',free)))) like '22023:%','invalid actor refused');
 skipped:=(select id from public.publication_channel_occurrences where project_id=(select id from p10_ids where name='social') and platform='facebook' and publication_id is null and skipped_at is null and id<>free order by scheduled_for desc limit 1);
 perform public.publication_occurrence_skip(skipped,'Jour férié','user_local');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',skipped)))) like '23514:Occurrence skipped%','skipped occurrence refused');
 reset role;
 -- Test clock only: an occurrence that has just passed (the snapshot guard is lifted inside this rolled-back transaction).
 alter table public.publication_channel_occurrences disable trigger channel_occurrence_update;
 update public.publication_channel_occurrences set scheduled_for=now()-interval '1 minute' where id=free;
 alter table public.publication_channel_occurrences enable trigger channel_occurrence_update;
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',free)))) like '23514:Occurrence in the past%','past occurrence refused');
 perform pg_temp.replay_assert((select current_revision_id=rev and occurrence_id is null and platform is null and status='draft' and archived_at is null from public.publications where id=pub),'draft intact after every refusal');
end $$;

-- 4. Multi-platform draft: one publication per platform on its own occurrence, grouped; source archived and linked.
do $$declare pub uuid:=pg_temp.sd_draft('Multi',array['facebook','instagram']);rev uuid;fb uuid:=pg_temp.p10_occ('facebook');ig uuid:=pg_temp.p10_occ('instagram');r jsonb;item jsonb;p public.publications;begin
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',fb)))) like '23514:Every draft platform%','every variant needs an occurrence');
 r:=public.publication_schedule_draft(pub,rev,jsonb_build_array(pg_temp.sd_assign('instagram',ig),pg_temp.sd_assign('facebook',fb)),'user_local');
 perform pg_temp.replay_assert(r->>'mode'='split' and jsonb_array_length(r->'publications')=2 and (r->>'archived_source_id')::uuid=pub,'split into two scheduled publications');
 for item in select value from jsonb_array_elements(r->'publications') loop
  select * into p from public.publications where id=(item->>'publication_id')::uuid;
  perform pg_temp.replay_assert(p.platform=item->>'platform' and p.occurrence_id=(item->>'occurrence_id')::uuid and p.editorial_group_id=(r->>'editorial_group_id')::uuid and p.status='draft'
   and p.target_date=(select local_date from public.publication_channel_occurrences where id=p.occurrence_id),'publication bound to its occurrence and group '||p.platform);
  perform pg_temp.replay_assert((select v.text_content='Texte '||p.platform||' Multi' from public.publication_variants v where v.revision_id=p.current_revision_id),'variant text kept '||p.platform);
  perform pg_temp.replay_assert((select array_agg(va.asset_id) from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.revision_id=p.current_revision_id)=array[(select id from sd_ids where name='Multi_asset')],'photo kept '||p.platform);
  perform pg_temp.replay_assert((select source_content='Message client : toiture refaite' and angle='Angle Multi' from public.publication_revisions where id=p.current_revision_id),'source and angle kept '||p.platform);
  perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=p.id and action='publication.created_from_occurrence' and (metadata->>'source_publication_id')::uuid=pub),'origin traced '||p.platform);
 end loop;
 perform pg_temp.replay_assert((select archived_at is not null and occurrence_id is null from public.publications where id=pub),'source draft archived, still readable');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=pub and action='publication.scheduled_split'),'split audited on the source');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,rev,jsonb_build_array(pg_temp.sd_assign('facebook',pg_temp.p10_occ('facebook')),pg_temp.sd_assign('instagram',pg_temp.p10_occ('instagram')))))
  like '55000:%','archived source cannot be scheduled twice');
end $$;

-- 5. A draft that already has a weekly slot is not this RPC's business.
do $$declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');pub uuid;begin
 pub:=public.publication_save_draft(null,null,cl,s,'Avec créneau','A','S',null,'2027-04-05',null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 perform pg_temp.replay_assert(pg_temp.sd_error(format('select public.publication_schedule_draft(%L,%L,%L,''user_local'')',pub,(select current_revision_id from public.publications where id=pub),jsonb_build_array(pg_temp.sd_assign('facebook',pg_temp.p10_occ('facebook')))))
  ='55000:Publication already scheduled','slot-scheduled publication refused');
end $$;
reset role;
