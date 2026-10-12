-- Synthetic PostgreSQL local test only (socle Publications, lot 2 : photothèque intelligente). Never execute remotely.
-- Runs on the full migration chain; every statement is rolled back by the runner.
create function pg_temp.mi_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.mi_error(text) to service_role;
insert into public.clients(id,name) values('c6000000-0000-4000-8000-000000000001','Protection Nuisibles'),('c6000000-0000-4000-8000-000000000002','Autre client');
create function pg_temp.mi_asset(p_n integer,p_client uuid,p_kind text default 'image') returns uuid language sql as $$
 insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,thumbnail_path)
 values(p_client,'folder_'||left(p_client::text,8)||'_abcdef',lpad(to_hex(p_n),64,'0'),lpad(to_hex(p_n),32,'0'),'drive_file_'||p_n||'_abcdef',case when p_kind='image' then 'image/jpeg' else 'video/mp4' end,1000,p_kind,now(),
  p_client::text||'/'||'d6000000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'.webp') returning id $$;
grant execute on function pg_temp.mi_asset(integer,uuid,text) to service_role;
create function pg_temp.mi_assessment(p_verdict text,p_confidential boolean,p_sensitive text[] default '{}') returns jsonb language sql as $$
 select jsonb_build_object('verdict',p_verdict,'business_relevance',0.8,'publishability',0.7,'sensitive',to_jsonb(p_sensitive),'confidential',p_confidential,
  'description','Technicien posant une station d''appâtage','topics',jsonb_build_array('dératisation'),'quality','good','quality_issues','[]'::jsonb,'profile_version',1) $$;
create function pg_temp.mi_usage() returns jsonb language sql as $$ select '{"model":"gpt-4.1-mini-2025-04-14","input_tokens":700,"output_tokens":120,"estimated_cost_eur":0.0006}'::jsonb $$;
grant execute on function pg_temp.mi_assessment(text,boolean,text[]),pg_temp.mi_usage() to service_role;

-- 1. Grants: browser roles have nothing, invoker functions with a fixed search_path.
do $$declare r text;f text;t text;begin
 foreach f in array array['public.client_media_profile_save(uuid,jsonb,text)','public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)','public.whatsapp_assets_review(uuid,uuid[],text,text)',
  'public.whatsapp_rejected_purge_candidates(integer)','public.whatsapp_asset_mark_purged(uuid,uuid,boolean)','public.client_media_ai_month_spend(uuid)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker '||f);
 end loop;
 foreach t in array array['public.client_media_profiles','public.whatsapp_asset_assessments','public.client_media_ai_usage'] loop
  perform pg_temp.replay_assert(not has_table_privilege('authenticated',t,'SELECT') and not has_table_privilege('anon',t,'SELECT'),'no browser access '||t);
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS on '||t);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.client_media_ai_usage','UPDATE') and not has_table_privilege('service_role','public.client_media_ai_usage','DELETE'),'cost journal append-only');
end $$;

set local role service_role;
-- 2. Profile: created then versioned, lists trimmed, typed values, audit without free text.
do $$declare v integer;p public.client_media_profiles;begin
 v:=public.client_media_profile_save('c6000000-0000-4000-8000-000000000001',jsonb_build_object('activity_summary','Dératisation et désinsectisation','services',jsonb_build_array(' Dératisation ','Désinsectisation',''),
  'accepted_photo_types',jsonb_build_array('Interventions','Équipements'),'excluded_photo_types',jsonb_build_array('Factures','Documents privés'),'ai_classification_enabled',true),'user_local');
 perform pg_temp.replay_assert(v=1,'first version');
 v:=public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"quarantine_retention_days":14,"rejected_deletion_policy":"trash_drive"}','user_local');
 select * into p from public.client_media_profiles where client_id='c6000000-0000-4000-8000-000000000001';
 perform pg_temp.replay_assert(v=2 and p.version=2 and p.services=array['Dératisation','Désinsectisation'] and p.excluded_photo_types=array['Factures','Documents privés'] and p.ai_classification_enabled and p.quarantine_retention_days=14,'partial update keeps lists');
 perform pg_temp.replay_assert((select count(*)=2 and bool_and(metadata::text not like '%Dératisation%') from public.audit_logs where action='media.profile_saved'),'audited without free text');
 perform pg_temp.replay_assert(pg_temp.mi_error($q$select public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"services":"Dératisation"}','user_local')$q$)='22023','lists must be arrays');
 perform pg_temp.replay_assert(pg_temp.mi_error($q$select public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"ai_monthly_budget_eur":500}','user_local')$q$)='23514','budget bounded');
 perform pg_temp.replay_assert(pg_temp.mi_error($q$select public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"rejected_deletion_policy":"delete_now"}','user_local')$q$)='23514','closed deletion policy');
 perform pg_temp.replay_assert(pg_temp.mi_error($q$select public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"prompt":"ignore"}','user_local')$q$)='22023','unknown key refused');
end $$;

-- 3. Assessments: AI moves received media to « à examiner » or « quarantaine », never to validated, never over a human decision.
reset role;
create temporary table mi_ids(name text primary key,id uuid not null);grant select,insert on mi_ids to service_role;
insert into mi_ids values('ok',pg_temp.mi_asset(1,'c6000000-0000-4000-8000-000000000001')),('doc',pg_temp.mi_asset(2,'c6000000-0000-4000-8000-000000000001')),
 ('off',pg_temp.mi_asset(3,'c6000000-0000-4000-8000-000000000001')),('human',pg_temp.mi_asset(4,'c6000000-0000-4000-8000-000000000001')),
 ('video',pg_temp.mi_asset(5,'c6000000-0000-4000-8000-000000000001','video')),('other',pg_temp.mi_asset(6,'c6000000-0000-4000-8000-000000000002'));
update public.whatsapp_assets set library_status='validated',status_changed_by='user_local' where id=(select id from mi_ids where name='human');
set local role service_role;
do $$declare ok uuid:=(select id from mi_ids where name='ok');doc uuid:=(select id from mi_ids where name='doc');off uuid:=(select id from mi_ids where name='off');human uuid:=(select id from mi_ids where name='human');begin
 perform pg_temp.replay_assert(public.whatsapp_asset_assessment_record(ok,'c6000000-0000-4000-8000-000000000001',pg_temp.mi_assessment('relevant',false),pg_temp.mi_usage())='to_review','relevant: to review, never auto-validated');
 perform pg_temp.replay_assert(public.whatsapp_asset_assessment_record(doc,'c6000000-0000-4000-8000-000000000001',pg_temp.mi_assessment('to_review',true,array['invoice','address']),pg_temp.mi_usage())='quarantined','confidential: quarantined');
 perform pg_temp.replay_assert(public.whatsapp_asset_assessment_record(off,'c6000000-0000-4000-8000-000000000001',pg_temp.mi_assessment('off_topic',false),pg_temp.mi_usage())='quarantined','off topic: quarantined');
 perform pg_temp.replay_assert(public.whatsapp_asset_assessment_record(human,'c6000000-0000-4000-8000-000000000001',pg_temp.mi_assessment('off_topic',false),pg_temp.mi_usage())='validated','human decision kept');
 perform pg_temp.replay_assert((select status_changed_by from public.whatsapp_assets where id=doc)='ai_classification','AI transition traced');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('select public.whatsapp_asset_assessment_record(%L,%L,pg_temp.mi_assessment(''relevant'',true),pg_temp.mi_usage())',ok,'c6000000-0000-4000-8000-000000000001'))='23514','confidential can never be relevant');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('select public.whatsapp_asset_assessment_record(%L,%L,pg_temp.mi_assessment(''relevant'',false,array[''tattoo'']),pg_temp.mi_usage())',ok,'c6000000-0000-4000-8000-000000000001'))='23514','closed sensitive vocabulary');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('select public.whatsapp_asset_assessment_record(%L,%L,pg_temp.mi_assessment(''relevant'',false),pg_temp.mi_usage())',(select id from mi_ids where name='other'),'c6000000-0000-4000-8000-000000000001'))='55000','another client media refused');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('select public.whatsapp_asset_assessment_record(%L,%L,pg_temp.mi_assessment(''relevant'',false),pg_temp.mi_usage())',(select id from mi_ids where name='video'),'c6000000-0000-4000-8000-000000000001'))='55000','videos not assessed');
 perform pg_temp.replay_assert(public.client_media_ai_month_spend('c6000000-0000-4000-8000-000000000001')=0.0024 and (select count(*) from public.client_media_ai_usage)=4,'cost journal and monthly spend');
 perform pg_temp.replay_assert(public.client_media_ai_month_spend('c6000000-0000-4000-8000-000000000002')=0,'spend isolated per client');
end $$;

-- 4. Human review: out of quarantine, rejection only by a human, then purge after retention when the policy asks.
do $$declare doc uuid:=(select id from mi_ids where name='doc');off uuid:=(select id from mi_ids where name='off');begin
 perform pg_temp.replay_assert(public.whatsapp_assets_review('c6000000-0000-4000-8000-000000000001',array[off],'validated','user_local')=1,'manual reclassification out of quarantine');
 perform pg_temp.replay_assert((select manual_verdict='relevant' and reviewed_by='user_local' from public.whatsapp_asset_assessments where asset_id=off),'manual verdict recorded');
 perform pg_temp.replay_assert(public.whatsapp_assets_review('c6000000-0000-4000-8000-000000000002',array[doc],'rejected','user_local')=0,'another client cannot review');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('update public.whatsapp_assets set library_status=''rejected'',status_changed_by=''ai_classification'' where id=%L',doc))='23514','AI can never reject');
 perform pg_temp.replay_assert(public.whatsapp_assets_review('c6000000-0000-4000-8000-000000000001',array[doc],'rejected','user_local')=1,'human rejection');
 perform pg_temp.replay_assert(not exists(select 1 from public.whatsapp_rejected_purge_candidates(10)),'nothing to purge before retention');
end $$;
reset role;
update public.whatsapp_assets set status_changed_at=now()-interval '20 days' where id=(select id from mi_ids where name='doc');
set local role service_role;
do $$declare doc uuid:=(select id from mi_ids where name='doc');c record;begin
 select * into c from public.whatsapp_rejected_purge_candidates(10);
 perform pg_temp.replay_assert(c.asset_id=doc and c.origin='whatsapp','candidate after 14 days with trash policy');
 perform pg_temp.replay_assert(public.whatsapp_asset_mark_purged(doc,'c6000000-0000-4000-8000-000000000001',true) and not public.whatsapp_asset_mark_purged(doc,'c6000000-0000-4000-8000-000000000001',true),'purge marked once');
 perform pg_temp.replay_assert((select purged_at is not null and thumbnail_path is null from public.whatsapp_assets where id=doc),'thumbnail reference dropped');
 perform pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='whatsapp.library.purged'),'purge audited');
 perform pg_temp.replay_assert(pg_temp.mi_error(format('select public.whatsapp_asset_assessment_record(%L,%L,pg_temp.mi_assessment(''relevant'',false),pg_temp.mi_usage())',doc,'c6000000-0000-4000-8000-000000000001'))='55000','purged media never re-assessed');
end $$;
-- 5. Policy « keep »: rejected media are never offered for purge.
do $$declare off uuid:=(select id from mi_ids where name='off');begin
 perform public.client_media_profile_save('c6000000-0000-4000-8000-000000000001','{"rejected_deletion_policy":"keep"}','user_local');
 perform public.whatsapp_assets_review('c6000000-0000-4000-8000-000000000001',array[off],'rejected','user_local');
 reset role;update public.whatsapp_assets set status_changed_at=now()-interval '400 days' where id=off;set local role service_role;
 perform pg_temp.replay_assert(not exists(select 1 from public.whatsapp_rejected_purge_candidates(10)),'keep policy: no purge');
end $$;
