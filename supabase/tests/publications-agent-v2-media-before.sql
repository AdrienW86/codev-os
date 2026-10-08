-- Synthetic PostgreSQL local test only (Lot 4.3 P8). Never execute on a remote project.
-- State built with P1 … P7 BEFORE the P8 migration: fixtures, a P7 run completed with a suggested (never attached)
-- media and a publication approved without media (legacy). Runtime UUIDs, dates relative to today.
create temporary table p8_ids(name text primary key,id uuid not null);
grant select,insert,update on p8_ids to service_role;
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();media text;n integer:=0;begin
 insert into public.clients(id,name,activity) values(cl,'P8 fixture','Couverture'),(other,'P8 other client',null);
 insert into p8_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('other_project',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p8_ids where name='social'),cl,'P8 social','Réseaux sociaux'),
  ((select id from p8_ids where name='other_project'),other,'P8 other','Réseaux sociaux');
 foreach media in array array['legacy','m_full','m_fail','m_unusable','m_archive','m_reject','m_inject','m_folder','m_other','m_spare'] loop
  n:=n+1;insert into p8_ids values(media,gen_random_uuid());
  insert into public.publication_drive_media(id,client_id,drive_file_id,drive_folder_id,name,mime_type,modified_at,file_size,analysis)
  values((select id from p8_ids where name=media),case when media='m_other' then other else cl end,'file'||lpad(n::text,10,'0'),
   case media when 'm_folder' then 'folder00000009' when 'm_other' then 'folder00000002' else 'folder00000001' end,media||'.jpg','image/jpeg',now(),1000+n,'{"scene":"roof","usable":true}');
 end loop;
 update public.agents set max_monthly_budget_eur=50 where publication_specialist;
end $$;
set local role service_role;
do $$
declare s uuid:=(select id from p8_ids where name='social');o uuid:=(select id from p8_ids where name='other_project');every_day text;start date:=current_date+1;
begin
 insert into p8_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local')),
  ('other_fb',public.publication_channel_save(o,'facebook',true,null,null,'user_local'));
 insert into p8_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 for every_day in select unnest(array['fb:12:00','ig:18:00','gbp:09:00','other_fb:12:00']) loop
  perform public.publication_channel_schedule_save((select id from p8_ids where name=split_part(every_day,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(every_day,length(split_part(every_day,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,start,start+20,'user_local');
 perform public.publication_channel_occurrences_ensure(o,start,start+6,'user_local');
 perform public.publication_agent_configure(s,'folder00000001','["Couverture"]','Ton sobre',true,true,'user_local');
 perform public.publication_agent_configure(o,'folder00000002','["Couverture"]','',true,true,'user_local');
end $$;
reset role;
-- Helpers: next future OPEN occurrence of a platform; one Agent v2 run (begin + finish) on the next occurrences.
create function pg_temp.p8_occ(p_platform text,p_project text default 'social') returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=(select id from p8_ids where name=p_project) and platform=p_platform and scheduled_for>now()
  and publication_id is null and skipped_at is null order by scheduled_for limit 1 $$;
create function pg_temp.p8_run(p_media text,p_platforms text[]) returns uuid language plpgsql as $$
declare s uuid:=(select id from p8_ids where name='social');occ uuid[]:=array[]::uuid[];pubs jsonb:='[]'::jsonb;o uuid;pl text;run uuid;
begin
 foreach pl in array p_platforms loop o:=pg_temp.p8_occ(pl);occ:=occ||o;pubs:=pubs||jsonb_build_array(jsonb_build_object('occurrence_id',o,'text','Texte '||pl||' '||o,'cta',null));end loop;
 run:=(public.publication_agent_v2_begin(s,occ,cardinality(occ),'user_local')->>'run_id')::uuid;
 perform public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Sujet P8','angle','Angle P8'),'publications',pubs),
  (select id from p8_ids where name=p_media),'{"input_tokens":10,"output_tokens":10,"estimated_cost_eur":0.0001}','user_local');
 return run;
end $$;
grant execute on function pg_temp.p8_occ(text,text),pg_temp.p8_run(text,text[]) to service_role;
set local role service_role;
do $$declare r jsonb;begin
 -- P7 run completed with a suggested media that was never attached.
 insert into p8_ids values('legacy_run',pg_temp.p8_run('legacy',array['facebook','instagram','google_business_profile']));
 -- Publication approved WITHOUT media before P8 (allowed by the historical SQL rules).
 r:=public.publication_create_from_occurrence(pg_temp.p8_occ('facebook'),null,null,'Legacy','Texte legacy',null,'user_local');
 insert into p8_ids values('legacy_approved',(r->>'publication_id')::uuid);
 perform public.publication_submit_manual((r->>'publication_id')::uuid,(r->>'revision_id')::uuid,'user_local');
 perform public.publication_review_manual((r->>'publication_id')::uuid,(r->>'revision_id')::uuid,'approved',null,'user_local');
end $$;
reset role;
create temporary table p8_before as select jsonb_build_object(
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'media',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.publication_drive_media m),
 'assets',(select count(*) from public.publication_assets),'uses',(select count(*) from public.publication_media_uses),
 'events',(select count(*) from public.publication_events)) v;
