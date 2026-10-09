-- Synthetic PostgreSQL local test only (Lot 4.3 P4-b). Never execute on a remote project.
-- Runs after P1, P2-a, P3, P4-a and P4-b on a rebuilt local database. Fixtures use runtime UUIDs.
create temporary table p4b_ids(name text primary key,id uuid not null);
grant select,insert,update on p4b_ids to service_role;

-- 1. Grants and function properties.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_create_from_occurrence(uuid,uuid,text,text,text,jsonb,text)','public.publication_occurrence_skip(uuid,text,text)',
  'publications_private.guard_publication_binding()','public.publication_save_draft(uuid,uuid,uuid,uuid,text,text,text,date,date,smallint,jsonb,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publications','DELETE') and not has_table_privilege('service_role','public.publications','TRUNCATE'),'publications never deletable by the server');
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_occurrence_skip(null,''x'',''user_local'')','42501','actual anon RPC denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_create_from_occurrence(null,null,null,''s'',''t'',null,''user_local'')','42501','actual authenticated RPC denied');
reset role;

-- 2. Migration is additive: no publication, group, occurrence or audit change.
select pg_temp.replay_assert((select v from p4b_before)=jsonb_build_object(
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'variants',(select count(*) from public.publication_variants),'groups',(select count(*) from public.publication_editorial_groups),
 'occurrences',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.publication_channel_occurrences o),
 'events',(select count(*) from public.publication_events)),'existing data unchanged by the migration');

-- Fixtures: configured project with 8 occurrences in one week (FB x5, IG x2, GBP x1), second project, legacy, other client.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P4-b fixture'),(other,'P4-b other client');
 insert into p4b_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('second',gen_random_uuid()),('legacy',gen_random_uuid()),('other_project',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p4b_ids where name='social'),cl,'P4-b social','Réseaux sociaux'),
  ((select id from p4b_ids where name='second'),cl,'P4-b second','Réseaux sociaux'),((select id from p4b_ids where name='legacy'),cl,'P4-b legacy','Réseaux sociaux'),
  ((select id from p4b_ids where name='other_project'),other,'P4-b other','Réseaux sociaux');
end $$;
set local role service_role;
do $$
declare s uuid:=(select id from p4b_ids where name='social');sec uuid:=(select id from p4b_ids where name='second');o uuid:=(select id from p4b_ids where name='other_project');
begin
 insert into p4b_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local')),
  ('second_fb',public.publication_channel_save(sec,'facebook',true,null,null,'user_local')),('other_fb',public.publication_channel_save(o,'facebook',true,null,null,'user_local'));
 insert into p4b_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 perform public.publication_channel_schedule_save((select id from p4b_ids where name='fb'),'Europe/Paris',true,
  '[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":2,"local_time":"09:00","enabled":true},{"weekday":4,"local_time":"09:00","enabled":true},{"weekday":5,"local_time":"12:00","enabled":true},{"weekday":7,"local_time":"10:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4b_ids where name='ig'),'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true},{"weekday":6,"local_time":"11:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4b_ids where name='gbp'),'Europe/Paris',true,'[{"weekday":3,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4b_ids where name='second_fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p4b_ids where name='other_fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-25','user_local');
 perform public.publication_channel_occurrences_ensure(sec,'2026-10-12','2026-10-18','user_local');
 perform public.publication_channel_occurrences_ensure(o,'2026-10-12','2026-10-18','user_local');
 insert into p4b_ids select 'occ_'||platform||'_'||to_char(local_date,'MMDD'),id from public.publication_channel_occurrences where project_id=s;
 insert into p4b_ids select 'occ_second',id from public.publication_channel_occurrences where project_id=sec;
 insert into p4b_ids select 'occ_other',id from public.publication_channel_occurrences where project_id=o;
end $$;

-- 3. Creation from an occurrence (Facebook, no group): one draft, one revision, one variant, mirror, audit.
do $$
declare s uuid:=(select id from p4b_ids where name='social');occ uuid:=(select id from p4b_ids where name='occ_facebook_1012');r jsonb;pub uuid;e public.publication_events;events bigint;
begin
 select count(*) into events from public.publication_events;
 r:=public.publication_create_from_occurrence(occ,null,null,'  Entretien toiture  ','Texte Facebook complet',jsonb_build_object('cta','Nous contacter'),'user_local');
 pub:=(r->>'publication_id')::uuid;insert into p4b_ids values('pub_fb',pub);
 perform pg_temp.replay_assert(r->>'editorial_group_id' is null and r->>'editorial_group_created'='false','no group requested');
 perform pg_temp.replay_assert((select platform='facebook' and occurrence_id=occ and status='draft' and subject='Entretien toiture' and target_date='2026-10-12' and editorial_week='2026-10-12'
  and project_id=s and editorial_group_id is null and current_revision_id=(r->>'revision_id')::uuid and creation_origin='manual' from public.publications where id=pub),'mono-platform draft bound to the occurrence');
 perform pg_temp.replay_assert((select count(*)=1 and bool_and(platform='facebook' and text_content='Texte Facebook complet' and metadata=jsonb_build_object('cta','Nous contacter'))
  from public.publication_variants where publication_id=pub),'exactly one variant on the occurrence platform');
 perform pg_temp.replay_assert((select revision_number=1 and origin='manual' and internal_title='Entretien toiture' and project_id=s and target_date='2026-10-12' from public.publication_revisions where id=(r->>'revision_id')::uuid),'initial revision snapshot');
 perform pg_temp.replay_assert((select publication_id from public.publication_channel_occurrences where id=occ)=pub,'occurrence mirror');
 select * into e from public.publication_events where action='publication.created_from_occurrence' and resource_id=pub;
 perform pg_temp.replay_assert(e.actor_id='user_local' and e.resource_type='publication' and e.metadata=jsonb_build_object('project_id',s,'occurrence_id',occ,'publication_id',pub,'platform','facebook',
  'editorial_group_id',null,'editorial_group_created',false,'revision_id',(r->>'revision_id')::uuid),'creation audit (no text)');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events+1,'one audit event');
end $$;

-- 4. Editorial groups: new group, existing group, sisters FB / IG / GBP, one publication per platform, foreign groups refused.
do $$
declare s uuid:=(select id from p4b_ids where name='social');r jsonb;g uuid;other_group uuid:=gen_random_uuid();foreign_group uuid:=gen_random_uuid();events bigint;
begin
 r:=public.publication_create_from_occurrence((select id from p4b_ids where name='occ_instagram_1013'),null,'Toiture avant l’hiver','Toiture · Instagram','Texte Instagram',null,'user_local');
 g:=(r->>'editorial_group_id')::uuid;insert into p4b_ids values('group',g),('pub_ig',(r->>'publication_id')::uuid);
 perform pg_temp.replay_assert(r->>'editorial_group_created'='true' and (select subject='Toiture avant l’hiver' and origin='manual' and project_id=s from public.publication_editorial_groups where id=g),'new group created');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.editorial_group_created' and resource_id=g and resource_type='editorial_group')=1,'group creation audited');
 r:=public.publication_create_from_occurrence((select id from p4b_ids where name='occ_google_business_profile_1014'),g,null,'Toiture · GBP','Texte GBP',null,'user_local');
 perform pg_temp.replay_assert(r->>'editorial_group_id'=g::text and r->>'editorial_group_created'='false','existing group reused');
 r:=public.publication_create_from_occurrence((select id from p4b_ids where name='occ_facebook_1013'),g,null,'Toiture · Facebook','Texte FB',null,'user_local');
 insert into p4b_ids values('pub_fb_group',(r->>'publication_id')::uuid);
 perform pg_temp.replay_assert((select array_agg(platform order by platform) from public.publications where editorial_group_id=g)=array['facebook','google_business_profile','instagram'],'three sister publications, each its own occurrence and text');
 perform pg_temp.replay_assert((select count(distinct occurrence_id) from public.publications where editorial_group_id=g)=3,'sisters on distinct occurrences');
 select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,%L,null,''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015'),g),'23505','one publication per platform in a group');
 perform pg_temp.replay_assert((select publication_id is null from public.publication_channel_occurrences where id=(select id from p4b_ids where name='occ_facebook_1015')) and (select count(*) from public.publication_events)=events,'refusal rolled back (occurrence open, no audit)');
 reset role;
 insert into public.publication_editorial_groups(id,client_id,project_id,subject) values(other_group,(select id from p4b_ids where name='client'),(select id from p4b_ids where name='second'),'Autre projet'),
  (foreign_group,(select id from p4b_ids where name='other_client'),(select id from p4b_ids where name='other_project'),'Autre client');
 set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,%L,null,''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015'),other_group),'23514','group of another project refused');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,%L,null,''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015'),foreign_group),'23514','group of another client refused');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,%L,''Nouveau'',''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015'),g),'22023','existing and new group together refused');
end $$;

-- 5. Refusals: skipped / linked / double creation / unknown occurrence / invalid input / disabled channel.
do $$
declare occ_skipped uuid:=(select id from p4b_ids where name='occ_instagram_1017');pubs bigint;events bigint;
begin
 perform public.publication_occurrence_skip(occ_skipped,'Fermeture exceptionnelle','user_local');
 select count(*) into pubs from public.publications;select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',null,''user_local'')',occ_skipped),'23514','skipped occurrence refused');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1012')),'23505','linked occurrence refused (double creation)');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',null,''user_local'')',gen_random_uuid()),'23514','unknown occurrence');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,'' '',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015')),'22023','blank subject');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'','' '',null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015')),'22023','blank text');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',%L,null,''user_local'')',(select id from p4b_ids where name='occ_facebook_1015'),repeat('t',10001)),'22023','text too long');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',''{"token":"secret"}'',''user_local'')',(select id from p4b_ids where name='occ_facebook_1015')),'22023','unsafe metadata');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',null,''admin'')',(select id from p4b_ids where name='occ_facebook_1015')),'22023','invalid actor');
 perform public.publication_channel_save((select id from p4b_ids where name='social'),'google_business_profile',false,null,null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''x'',''y'',null,''user_local'')',(select id from p4b_ids where name='occ_google_business_profile_1021')),'23514','disabled channel refused');
 perform public.publication_channel_save((select id from p4b_ids where name='social'),'google_business_profile',true,null,null,'user_local');
 perform pg_temp.replay_assert((select count(*) from public.publications)=pubs and (select count(*) from public.publication_events)=events+2,'refusals created nothing (only the two channel saves were audited)');
end $$;

-- 6. Occurrence-bound publications are not capped at two per week (5+ in the same project week).
do $$
declare s uuid:=(select id from p4b_ids where name='social');n text;
begin
 foreach n in array array['occ_facebook_1015','occ_facebook_1016','occ_facebook_1018'] loop
  perform public.publication_create_from_occurrence((select id from p4b_ids where name=n),null,null,'Sujet '||n,'Texte '||n,null,'user_local');
 end loop;
 perform pg_temp.replay_assert((select count(*) from public.publications where project_id=s and editorial_week='2026-10-12' and occurrence_id is not null)=7,'7 occurrence-bound publications in one week');
 perform pg_temp.replay_assert((select count(*) from public.publications where project_id=s and editorial_week='2026-10-12' and slot=1)=7,'all on legacy slot 1 without conflict');
end $$;

-- 7. Editing a P4 publication: new revision, single variant on its platform, date and platform fixed.
do $$
declare cl uuid:=(select id from p4b_ids where name='client');s uuid:=(select id from p4b_ids where name='social');pub uuid:=(select id from p4b_ids where name='pub_fb');rev uuid;
begin
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_save_draft(pub,rev,cl,s,'Entretien toiture v2','Angle','Source','2026-10-12',null,null,'[{"platform":"facebook","text_content":"Texte v2"}]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_revisions where publication_id=pub)=2 and (select count(*) from public.publication_variants v join public.publications p on p.current_revision_id=v.revision_id where p.id=pub)=1,'new revision with a single variant');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',''2026-10-12'',null,null,''[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]'',''user_local'')',pub,rev,cl,s),'23514','other platform variant refused');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',''2026-10-20'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',pub,rev,cl,s),'23514','occurrence date cannot change');
 perform pg_temp.replay_assert((select platform='facebook' and occurrence_id=(select id from p4b_ids where name='occ_facebook_1012') and target_date='2026-10-12' from public.publications where id=pub),'binding unchanged');
end $$;

-- 8. Legacy workflows unchanged; the legacy weekly bound ignores occurrence-bound rows.
do $$
declare cl uuid:=(select id from p4b_ids where name='client');s uuid:=(select id from p4b_ids where name='social');l uuid:=(select id from p4b_ids where name='legacy');a uuid;b uuid;
begin
 a:=public.publication_save_draft(null,null,cl,l,'Legacy FB+IG','A','S','2026-11-02',null,null,'[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_variants where publication_id=a)=2 and (select platform is null and occurrence_id is null from public.publications where id=a),'legacy multi-variant creation');
 perform public.publication_save_draft(null,null,cl,l,'Legacy 2','A','S','2026-11-03',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(null,null,%L,%L,''Legacy 3'',''A'',''S'',''2026-11-04'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',cl,l),'23505','legacy two-slot bound kept');
 -- Manual legacy creation in a week that already holds 7 occurrence-bound publications of the same project.
 b:=public.publication_save_draft(null,null,cl,s,'Manuel même semaine','A','S','2026-10-14',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 perform pg_temp.replay_assert((select slot=1 and occurrence_id is null from public.publications where id=b),'legacy allocator ignores occurrence-bound publications');
end $$;

-- 9. Skip: one-way, audited, never recreated, refusals.
do $$
declare s uuid:=(select id from p4b_ids where name='social');occ uuid:=(select id from p4b_ids where name='occ_facebook_1019');e public.publication_events;n bigint;r jsonb;
begin
 perform pg_temp.replay_assert(public.publication_occurrence_skip(occ,'  Jour férié  ','user_local')=occ,'open -> skipped');
 perform pg_temp.replay_assert((select skipped_at is not null and skipped_reason='Jour férié' and publication_id is null from public.publication_channel_occurrences where id=occ),'reason trimmed and stored on the occurrence');
 select * into e from public.publication_events where action='publication.occurrence_skipped' and resource_id=occ;
 perform pg_temp.replay_assert(e.resource_type='project_channel_occurrence' and e.metadata=jsonb_build_object('project_id',s,'occurrence_id',occ,'platform','facebook','local_date','2026-10-19')
  and e.metadata::text !~ 'férié','skip audited without the free text');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,''encore'',''user_local'')',occ),'55000','already skipped');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,''x'',''user_local'')',(select id from p4b_ids where name='occ_facebook_1012')),'23514','linked occurrence cannot be skipped');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,'' '',''user_local'')',(select id from p4b_ids where name='occ_facebook_1022')),'22023','empty reason');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,%L,''user_local'')',(select id from p4b_ids where name='occ_facebook_1022'),repeat('r',501)),'22023','reason too long');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,%L,''user_local'')',(select id from p4b_ids where name='occ_facebook_1022'),'bad'||chr(10)||'reason'),'22023','control characters refused');
 perform pg_temp.replay_failure(format('select public.publication_occurrence_skip(%L,''x'',''user_local'')',gen_random_uuid()),'23514','unknown occurrence');
 select count(*) into n from public.publication_channel_occurrences where project_id=s;
 r:=public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-25','user_local');
 perform pg_temp.replay_assert(r->>'created'='0' and (select count(*) from public.publication_channel_occurrences where project_id=s)=n,'ensure never recreates skipped or linked occurrences');
end $$;
reset role;
select pg_temp.replay_failure(format('update public.publication_channel_occurrences set skipped_at=null,skipped_reason=null where id=%L',(select id from p4b_ids where name='occ_facebook_1019')),'55000','skip cannot be undone');

-- 10. Atomicity: failure injected on the final creation audit (after group, publication, revision and mirror).
create schema p4b_test_injection;
create function p4b_test_injection.fail_creation_event() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after creation writes' using errcode='P0001'; end $$;
grant usage on schema p4b_test_injection to service_role;grant execute on function p4b_test_injection.fail_creation_event() to service_role;
create trigger p4b_inject_creation before insert on public.publication_events for each row
 when (new.action='publication.created_from_occurrence') execute function p4b_test_injection.fail_creation_event();
set local role service_role;
do $$declare occ uuid:=(select id from p4b_ids where name='occ_facebook_1022');pubs bigint;groups bigint;events bigint;begin
 select count(*) into pubs from public.publications;select count(*) into groups from public.publication_editorial_groups;select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,''Groupe éphémère'',''x'',''y'',null,''user_local'')',occ),'P0001','injected failure after writes');
 perform pg_temp.replay_assert((select count(*) from public.publications)=pubs and (select count(*) from public.publication_editorial_groups)=groups and (select count(*) from public.publication_events)=events
  and (select publication_id is null from public.publication_channel_occurrences where id=occ),'nothing persisted: no publication, no group, no audit, occurrence still open');
end $$;
reset role;
drop trigger p4b_inject_creation on public.publication_events;
drop schema p4b_test_injection cascade;
select pg_temp.replay_assert(not exists(select 1 from pg_trigger where tgname='p4b_inject_creation'),'injection removed');

-- 11. Audit and safety.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action in('publication.created_from_occurrence','publication.occurrence_skipped','publication.editorial_group_created')
 and (coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(texte|text_content|token|secret|credential|external_account_id)'),'audit without publication text or secrets');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no delivery, no job, nothing published');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publications where status<>'draft' and occurrence_id is not null),'occurrence publications remain drafts');
