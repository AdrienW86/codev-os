-- Synthetic PostgreSQL local test only (Lot 4.3 P5). Never execute on a remote project.
-- Runs after P1 … P4-b and P5 on a rebuilt local database. Fixtures use runtime UUIDs.
create temporary table p5_ids(name text primary key,id uuid not null);
grant select,insert,update on p5_ids to service_role;

-- 1. Grants and function properties.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_archive(uuid,text)','publications_private.guard_publication_archive()','publications_private.guard_archived_publication_child()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publications','DELETE') and not has_table_privilege('service_role','public.publications','TRUNCATE'),'publications never deletable by the server');
end $$;
set local role authenticated;
select pg_temp.replay_failure('select public.publication_archive(null,''user_local'')','42501','actual authenticated RPC denied');
set local role service_role;
select pg_temp.replay_failure('delete from public.publications','42501','server delete denied at runtime');
reset role;

-- 2. Additive: nothing archived by the migration, existing rows unchanged.
select pg_temp.replay_assert(not exists(select 1 from public.publications where archived_at is not null or archived_by is not null),'nothing archived by the migration');
select pg_temp.replay_assert((select v->'publications' from p5_before)=(select coalesce(jsonb_agg(to_jsonb(p)-'archived_at'-'archived_by' order by p.id),'[]') from public.publications p)
 and (select v->'events' from p5_before)=to_jsonb((select count(*) from public.publication_events)),'publications and audit unchanged by the migration');

-- Fixtures: configured project, two sister publications from occurrences, one legacy publication with a decision.
do $$declare cl uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P5 fixture');
 insert into p5_ids values('client',cl),('social',gen_random_uuid()),('legacy',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p5_ids where name='social'),cl,'P5 social','Réseaux sociaux'),((select id from p5_ids where name='legacy'),cl,'P5 legacy','Réseaux sociaux');
end $$;
set local role service_role;
do $$
declare cl uuid:=(select id from p5_ids where name='client');s uuid:=(select id from p5_ids where name='social');l uuid:=(select id from p5_ids where name='legacy');r jsonb;pub uuid;rev uuid;
begin
 insert into p5_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local'));
 insert into p5_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 perform public.publication_channel_schedule_save((select id from p5_ids where name='fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p5_ids where name='ig'),'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true}]','user_local');
 perform public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-18','user_local');
 r:=public.publication_create_from_occurrence((select id from public.publication_channel_occurrences where project_id=s and platform='facebook'),null,'Toiture','Toiture · FB','Texte FB',null,'user_local');
 insert into p5_ids values('pub_fb',(r->>'publication_id')::uuid),('group',(r->>'editorial_group_id')::uuid),('occ_fb',(select id from public.publication_channel_occurrences where project_id=s and platform='facebook'));
 r:=public.publication_create_from_occurrence((select id from public.publication_channel_occurrences where project_id=s and platform='instagram'),(select id from p5_ids where name='group'),null,'Toiture · IG','Texte IG',null,'user_local');
 insert into p5_ids values('pub_ig',(r->>'publication_id')::uuid);
 pub:=public.publication_save_draft(null,null,cl,l,'Legacy','A','S','2026-11-02',null,null,'[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform public.publication_review_manual(pub,rev,'rejected','Motif de refus détaillé','user_local');
 insert into p5_ids values('legacy_pub',pub);
end $$;

-- 3. Archive: one-way, audited, history / occurrence link / group intact.
do $$
declare pub uuid:=(select id from p5_ids where name='pub_fb');g uuid:=(select id from p5_ids where name='group');at timestamptz;e public.publication_events;
 revisions bigint;variants bigint;events bigint;
begin
 select count(*) into revisions from public.publication_revisions where publication_id=pub;select count(*) into variants from public.publication_variants where publication_id=pub;
 select count(*) into events from public.publication_events;
 at:=public.publication_archive(pub,'user_local');
 perform pg_temp.replay_assert(at is not null and (select archived_at=at and archived_by='user_local' and status='draft' from public.publications where id=pub),'archived once, status kept');
 select * into e from public.publication_events where action='publication.archived' and resource_id=pub;
 perform pg_temp.replay_assert(e.actor_id='user_local' and e.metadata=jsonb_build_object('project_id',(select id from p5_ids where name='social'),'publication_id',pub,'platform','facebook',
  'occurrence_id',(select id from p5_ids where name='occ_fb'),'editorial_group_id',g,'status','draft') and (select count(*) from public.publication_events)=events+1,'archive audited (facts only)');
 perform pg_temp.replay_assert((select publication_id from public.publication_channel_occurrences where id=(select id from p5_ids where name='occ_fb'))=pub,'occurrence stays linked');
 perform pg_temp.replay_assert((select count(*) from public.publications where editorial_group_id=g)=2 and (select archived_at is null from public.publications where id=(select id from p5_ids where name='pub_ig')),'group and sister publication untouched');
 perform pg_temp.replay_assert((select count(*) from public.publication_revisions where publication_id=pub)=revisions and (select count(*) from public.publication_variants where publication_id=pub)=variants,'revisions and variants kept');
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''user_local'')',pub),'55000','double archive refused');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',''2026-10-12'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',
  pub,(select current_revision_id from public.publications where id=pub),(select id from p5_ids where name='client'),(select id from p5_ids where name='social')),'55000','no new revision on an archived publication');
 perform pg_temp.replay_failure(format('select public.publication_submit_manual(%L,%L,''user_local'')',pub,(select current_revision_id from public.publications where id=pub)),'55000','no submission of an archived publication');
 perform pg_temp.replay_assert((public.publication_channel_occurrences_ensure((select id from p5_ids where name='social'),'2026-10-12','2026-10-18','user_local')->>'created')::int=0,'ensure never recreates the linked occurrence');
end $$;

-- 4. Legacy publication with decisions can be archived; reviews and history stay readable.
do $$
declare pub uuid:=(select id from p5_ids where name='legacy_pub');reviews bigint;
begin
 select count(*) into reviews from public.publication_reviews where publication_id=pub;
 perform public.publication_archive(pub,'user_local');
 perform pg_temp.replay_assert((select status='rejected' and archived_at is not null and platform is null from public.publications where id=pub),'legacy rejected publication archived as is');
 perform pg_temp.replay_assert((select count(*) from public.publication_reviews where publication_id=pub)=reviews and reviews>0,'reviews kept');
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''admin'')',(select id from p5_ids where name='pub_ig')),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''user_local'')',gen_random_uuid()),'23514','unknown publication');
end $$;
reset role;

-- 5. Direct writes (owner): frozen row, no unarchive, archive cannot carry other changes, no child row.
do $$
declare pub uuid:=(select id from p5_ids where name='pub_fb');ig uuid:=(select id from p5_ids where name='pub_ig');
begin
 perform pg_temp.replay_failure(format('update public.publications set archived_at=null,archived_by=null where id=%L',pub),'55000','unarchive refused');
 perform pg_temp.replay_failure(format('update public.publications set subject=''Autre'' where id=%L',pub),'55000','archived row frozen');
 perform pg_temp.replay_failure(format('update public.publications set archived_at=now() where id=%L',ig),'23514','archive needs its actor');
 perform pg_temp.replay_failure(format('update public.publications set archived_at=now(),archived_by=''user_local'',status=''pending_review'' where id=%L',ig),'55000','archiving changes nothing else');
 perform pg_temp.replay_failure(format('insert into public.publication_variants(revision_id,publication_id,client_id,platform,text_content) select current_revision_id,id,client_id,''facebook'',''x'' from public.publications where id=%L',pub),'55000','no variant on an archived publication');
 perform pg_temp.replay_failure(format('delete from public.publications where id=%L',pub),'23503','archived publication is never deleted (history references it)');
end $$;

-- 6. Atomicity: failure injected on the archive audit leaves the publication active.
create schema p5_test_injection;
create function p5_test_injection.fail_archive_event() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure on archive audit' using errcode='P0001'; end $$;
grant usage on schema p5_test_injection to service_role;grant execute on function p5_test_injection.fail_archive_event() to service_role;
create trigger p5_inject_archive before insert on public.publication_events for each row when (new.action='publication.archived') execute function p5_test_injection.fail_archive_event();
set local role service_role;
do $$begin
 perform pg_temp.replay_failure(format('select public.publication_archive(%L,''user_local'')',(select id from p5_ids where name='pub_ig')),'P0001','injected failure');
 perform pg_temp.replay_assert((select archived_at is null and archived_by is null from public.publications where id=(select id from p5_ids where name='pub_ig')),'publication still active');
end $$;
reset role;
drop trigger p5_inject_archive on public.publication_events;
drop schema p5_test_injection cascade;

-- 7. Safety.
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no delivery, no job');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.archived' and metadata::text ~* '(texte|token|secret|credential)'),'archive audit without text or secrets');
