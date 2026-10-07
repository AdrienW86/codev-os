-- Synthetic PostgreSQL local test only (Lot 4.3 P4-a). Never execute on a remote project.
-- Runs after P1, P2-a, P3 and P4-a on a rebuilt local database. Fixtures use runtime UUIDs.
create temporary table p4_ids(name text primary key,id uuid not null);
grant select,insert,update on p4_ids to service_role;

-- 1. Structure, RLS, grants, functions.
select pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_editorial_groups'::regclass),'groups RLS enabled');
select pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename='publication_editorial_groups'),'groups without policy');
do $$declare r text;f text;begin
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_editorial_groups','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'browser privileges absent');
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_editorial_groups','SELECT,INSERT,UPDATE'),'server select/insert/update');
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_editorial_groups','DELETE') and not has_table_privilege('service_role','public.publication_editorial_groups','TRUNCATE'),'server delete/truncate denied');
 foreach f in array array['publications_private.guard_editorial_group()','publications_private.guard_publication_binding()','publications_private.link_publication_occurrence()','publications_private.guard_variant_platform()','publications_private.guard_channel_occurrence_update()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('anon','public.publications','SELECT') and not has_table_privilege('authenticated','public.publications','SELECT'),'publications still closed to browsers');
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_editorial_groups','42501','actual anon read denied');
set local role service_role;
select pg_temp.replay_failure('delete from public.publication_editorial_groups','42501','server delete denied at runtime');
reset role;

-- 2. Legacy publications: untouched (new columns NULL), no group created, historical data unchanged.
select pg_temp.replay_assert(not exists(select 1 from public.publication_editorial_groups),'no group created by the migration');
select pg_temp.replay_assert(not exists(select 1 from public.publications where editorial_group_id is not null or occurrence_id is not null or platform is not null),'legacy publications keep NULL bindings');
select pg_temp.replay_assert((select v->'publications' from p4_before)=(select coalesce(jsonb_agg(to_jsonb(p)-'editorial_group_id'-'occurrence_id'-'platform' order by p.id),'[]') from public.publications p)
 and (select v->'variants' from p4_before)=(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from public.publication_variants v)
 and (select v->'occurrences' from p4_before)=(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.publication_channel_occurrences o)
 and (select v->'events' from p4_before)=to_jsonb((select count(*) from public.publication_events)),'publications, variants, occurrences and audit unchanged by the migration');

-- Fixtures: configured project with FB / IG / GBP occurrences on the same week; legacy project; other project.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P4 groups fixture'),(other,'P4 other client');
 insert into p4_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('legacy',gen_random_uuid()),('second',gen_random_uuid()),('other_project',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p4_ids where name='social'),cl,'P4 social','Réseaux sociaux'),
  ((select id from p4_ids where name='legacy'),cl,'P4 legacy','Réseaux sociaux'),((select id from p4_ids where name='second'),cl,'P4 second','Réseaux sociaux'),
  ((select id from p4_ids where name='other_project'),other,'P4 other','Réseaux sociaux');
end $$;
set local role service_role;
do $$
declare s uuid:=(select id from p4_ids where name='social');sec uuid:=(select id from p4_ids where name='second');
begin
 insert into p4_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local')),
  ('second_fb',public.publication_channel_save(sec,'facebook',true,null,null,'user_local'));
 insert into p4_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 perform public.publication_channel_schedule_save((select id from p4_ids where name='fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":5,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4_ids where name='ig'),'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4_ids where name='gbp'),'Europe/Paris',true,'[{"weekday":3,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4_ids where name='second_fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-25','user_local');
 perform public.publication_channel_occurrences_ensure(sec,'2026-10-12','2026-10-18','user_local');
 insert into p4_ids select 'occ_'||platform||'_'||to_char(local_date,'MMDD'),id from public.publication_channel_occurrences where project_id=s;
 insert into p4_ids select 'occ_second',id from public.publication_channel_occurrences where project_id=sec;
end $$;
reset role;

-- 3. Editorial groups: scope, immutability, no delete / truncate.
do $$
declare cl uuid:=(select id from p4_ids where name='client');other uuid:=(select id from p4_ids where name='other_client');s uuid:=(select id from p4_ids where name='social');g uuid:=gen_random_uuid();
begin
 insert into public.publication_editorial_groups(id,client_id,project_id,subject) values(g,cl,s,'Entretien de toiture avant l’hiver');insert into p4_ids values('group',g);
 perform pg_temp.replay_failure(format('insert into public.publication_editorial_groups(client_id,project_id,subject) values(%L,%L,''x'')',other,s),'23503','group of another client');
 perform pg_temp.replay_failure(format('insert into public.publication_editorial_groups(client_id,project_id,subject) values(%L,%L,'' '')',cl,s),'23514','blank subject');
 perform pg_temp.replay_failure(format('insert into public.publication_editorial_groups(client_id,project_id,subject,origin) values(%L,%L,''x'',''worker'')',cl,s),'23514','unknown origin');
 perform pg_temp.replay_failure(format('update public.publication_editorial_groups set project_id=%L where id=%L',(select id from p4_ids where name='legacy'),g),'55000','group project immutable');
 perform pg_temp.replay_failure(format('update public.publication_editorial_groups set client_id=%L where id=%L',other,g),'55000','group client immutable');
 perform pg_temp.replay_failure(format('update public.publication_editorial_groups set origin=''agent'' where id=%L',g),'55000','group origin immutable');
 update public.publication_editorial_groups set subject='Entretien de toiture' where id=g;
 perform pg_temp.replay_assert((select subject from public.publication_editorial_groups where id=g)='Entretien de toiture','subject editable');
 perform pg_temp.replay_failure(format('delete from public.publication_editorial_groups where id=%L',g),'55000','group delete refused for owner');
 perform pg_temp.replay_failure('truncate public.publication_editorial_groups cascade','55000','group truncate refused for owner');
end $$;

-- 4. Sister mono-platform publications bound to their occurrences (FB + IG + GBP the same week).
do $$
declare cl uuid:=(select id from p4_ids where name='client');s uuid:=(select id from p4_ids where name='social');g uuid:=(select id from p4_ids where name='group');
 fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();gb uuid:=gen_random_uuid();fb2 uuid:=gen_random_uuid();empty_group uuid:=gen_random_uuid();
begin
 insert into public.publications(id,client_id,project_id,editorial_week,slot,subject,platform,occurrence_id,editorial_group_id) values
  (fb,cl,s,'2026-10-12',1,'Toiture · Facebook','facebook',(select id from p4_ids where name='occ_facebook_1012'),g),
  (ig,cl,s,'2026-10-12',1,'Toiture · Instagram','instagram',(select id from p4_ids where name='occ_instagram_1013'),g),
  (gb,cl,s,'2026-10-12',1,'Toiture · GBP','google_business_profile',(select id from p4_ids where name='occ_google_business_profile_1014'),g);
 insert into p4_ids values('pub_fb',fb),('pub_ig',ig),('pub_gbp',gb);
 perform pg_temp.replay_assert((select count(*) from public.publications where editorial_group_id=g)=3,'three sister publications in one group, same week');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_occurrences o join public.publications p on p.occurrence_id=o.id and o.publication_id=p.id where p.editorial_group_id=g)=3,'occurrence mirror maintained');
 -- A second Facebook publication of the same week, bound to the Friday occurrence, outside the group: allowed.
 insert into public.publications(id,client_id,project_id,editorial_week,slot,subject,platform,occurrence_id) values(fb2,cl,s,'2026-10-12',2,'Autre sujet','facebook',(select id from p4_ids where name='occ_facebook_1016'));
 perform pg_temp.replay_assert((select count(*) from public.publications where project_id=s and editorial_week='2026-10-12')=4,'occurrence-bound publications are not capped at two per week');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,occurrence_id,editorial_group_id) values(%L,%L,''2026-10-19'',1,''x'',''facebook'',%L,%L)',cl,s,(select id from p4_ids where name='occ_facebook_1019'),g),'23505','one publication per platform in a group');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,occurrence_id) values(%L,%L,''2026-10-12'',1,''x'',''facebook'',%L)',cl,s,(select id from p4_ids where name='occ_facebook_1012')),'23505','one publication per occurrence');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,occurrence_id) values(%L,%L,''2026-10-19'',1,''x'',''instagram'',%L)',cl,s,(select id from p4_ids where name='occ_facebook_1019')),'23503','publication platform must be the occurrence platform');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,occurrence_id) values(%L,%L,''2026-10-19'',1,''x'',''facebook'',%L)',cl,(select id from p4_ids where name='legacy'),(select id from p4_ids where name='occ_facebook_1019')),'23503','occurrence of another project');
 -- An empty group of the social project, so that only the cross-project FK can refuse the row.
 insert into public.publication_editorial_groups(id,client_id,project_id,subject) values(empty_group,cl,s,'Groupe vide');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,editorial_group_id) values(%L,%L,''2026-10-19'',1,''x'',''facebook'',%L)',cl,(select id from p4_ids where name='second'),empty_group),'23503','group of another project');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,editorial_week,slot,subject,platform,editorial_group_id) values(%L,''2026-10-19'',1,''x'',''facebook'',%L)',cl,g),'23514','group requires a project');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,editorial_group_id) values(%L,%L,''2026-10-19'',1,''x'',%L)',cl,s,g),'23514','group requires a platform');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,occurrence_id) values(%L,%L,''2026-10-19'',1,''x'',%L)',cl,s,(select id from p4_ids where name='occ_facebook_1019')),'23514','occurrence requires a platform');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform) values(%L,%L,''2026-10-19'',1,''x'',''tiktok'')',cl,s),'23514','unknown platform');
end $$;

-- 5. One-way bindings, skipped / already linked occurrences, mirror from the publication side only.
do $$
declare cl uuid:=(select id from p4_ids where name='client');s uuid:=(select id from p4_ids where name='social');fb uuid:=(select id from p4_ids where name='pub_fb');p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();
begin
 perform pg_temp.replay_failure(format('update public.publications set occurrence_id=null where id=%L',fb),'55000','occurrence binding cannot be removed');
 perform pg_temp.replay_failure(format('update public.publications set occurrence_id=%L where id=%L',(select id from p4_ids where name='occ_facebook_1019'),fb),'55000','occurrence binding cannot change');
 perform pg_temp.replay_failure(format('update public.publications set editorial_group_id=null where id=%L',fb),'55000','group binding cannot be removed');
 perform pg_temp.replay_failure(format('update public.publications set platform=''instagram'' where id=%L',fb),'55000','platform cannot change');
 update public.publication_channel_occurrences set skipped_at=now(),skipped_reason='Fermeture' where id=(select id from p4_ids where name='occ_google_business_profile_1021');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject,platform,occurrence_id) values(%L,%L,''2026-10-19'',1,''x'',''google_business_profile'',%L)',cl,s,(select id from p4_ids where name='occ_google_business_profile_1021')),'23514','skipped occurrence cannot be bound');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set publication_id=%L where id=%L',fb,(select id from p4_ids where name='occ_facebook_1019')),'23514','occurrence side cannot link a publication bound elsewhere');
 -- A mono-platform publication created first, bound later (NULL -> occurrence once).
 insert into public.publications(id,client_id,project_id,editorial_week,slot,subject,platform) values(p,cl,s,'2026-10-19',1,'Plus tard','facebook');
 update public.publications set occurrence_id=(select id from p4_ids where name='occ_facebook_1019') where id=p;
 perform pg_temp.replay_assert((select publication_id from public.publication_channel_occurrences where id=(select id from p4_ids where name='occ_facebook_1019'))=p,'late binding mirrored');
 insert into p4_ids values('pub_late',p);
 -- Legacy publication (platform NULL) cannot be bound to an occurrence.
 insert into public.publications(id,client_id,project_id,editorial_week,slot,subject) values(q,cl,s,'2026-10-26',1,'Legacy-like');
 perform pg_temp.replay_failure(format('update public.publications set occurrence_id=%L where id=%L',(select id from p4_ids where name='occ_facebook_1023'),q),'23514','legacy multi-variant publication cannot take an occurrence');
end $$;

-- 6. Mono-platform variants through the existing workflow; legacy multi-variant workflow unchanged.
set local role service_role;
do $$
declare cl uuid:=(select id from p4_ids where name='client');s uuid:=(select id from p4_ids where name='social');l uuid:=(select id from p4_ids where name='legacy');fb uuid:=(select id from p4_ids where name='pub_fb');legacy_pub uuid;
begin
 perform public.publication_save_draft(fb,null,cl,s,'Toiture · Facebook','Angle','Source',null,null,null,'[{"platform":"facebook","text_content":"Texte Facebook"}]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_variants where publication_id=fb and platform='facebook')=1,'mono-platform revision on its platform');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',null,null,null,''[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]'',''user_local'')',
  fb,(select current_revision_id from public.publications where id=fb),cl,s),'23514','mono-platform publication refuses another platform');
 legacy_pub:=public.publication_save_draft(null,null,cl,l,'Legacy FB+IG','A','S','2026-11-02',null,null,'[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_variants where publication_id=legacy_pub)=2 and (select platform is null from public.publications where id=legacy_pub),'legacy multi-variant creation unchanged');
 insert into p4_ids values('legacy_pub',legacy_pub);
end $$;
reset role;
do $$begin
 perform pg_temp.replay_failure(format('update public.publications set platform=''facebook'' where id=%L',(select id from p4_ids where name='legacy_pub')),'23514','platform cannot be set on a multi-variant publication');
end $$;

-- 7. The historical two-slot bound still applies to publications not bound to an occurrence.
set local role service_role;
do $$
declare cl uuid:=(select id from p4_ids where name='client');l uuid:=(select id from p4_ids where name='legacy');
begin
 perform public.publication_save_draft(null,null,cl,l,'Legacy 2','A','S','2026-11-03',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(null,null,%L,%L,''Legacy 3'',''A'',''S'',''2026-11-04'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',cl,l),'23505','third legacy publication of the week refused');
end $$;
reset role;

-- 8. Audit / safety: no automatic mutation; kill switch; no delivery / job.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action like 'publication.editorial%'),'no editorial-group audit produced without an RPC (P4-b)');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no deliveries, no external jobs');
select pg_temp.replay_assert((select v->'cadences' from p4_before)=(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c)
 and (select v->'slots' from p4_before)=(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),'legacy cadences and calendar slots untouched');
