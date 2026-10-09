-- Executed after both migrations by tests/publications-db.test.mjs, inside a
-- rolled-back transaction in a dedicated, empty local test database.
create temporary table sql_validation_counts(kind text primary key,passed bigint not null);
insert into sql_validation_counts values('assertions',0),('expected_rejections',0);
grant select,update on sql_validation_counts to anon,authenticated,service_role;
create function pg_temp.assert_true(value boolean, message text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'Assertion failed: %', message; end if;
  update pg_temp.sql_validation_counts set passed=passed+1 where kind='assertions';
end $$;
create function pg_temp.expect_failure(command text, expected_state text) returns void
language plpgsql as $$
declare failed boolean := false;
begin
  begin execute command;
  exception when others then
    failed := true;
    if sqlstate <> expected_state then raise exception 'Expected %, got %: %', expected_state, sqlstate, sqlerrm; end if;
  end;
  if not failed then raise exception 'Statement unexpectedly succeeded: %', command; end if;
  update pg_temp.sql_validation_counts set passed=passed+1 where kind='expected_rejections';
end $$;
do $$
declare temporary_schema text;
begin
  select nspname into temporary_schema from pg_namespace where oid=pg_my_temp_schema();
  execute format('grant usage on schema %I to anon, authenticated, service_role', temporary_schema);
  execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', temporary_schema);
end $$;

do $$
declare item record; table_count integer := 0;
begin
  for item in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and (c.relname like 'publication\_%' escape '\' or c.relname='publications') loop
    table_count := table_count + 1;
    perform pg_temp.assert_true(item.relrowsecurity, 'RLS ' || item.relname);
    perform pg_temp.assert_true(not has_table_privilege('anon','public.' || item.relname,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'anon ACL ' || item.relname);
    perform pg_temp.assert_true(not has_table_privilege('authenticated','public.' || item.relname,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated ACL ' || item.relname);
    perform pg_temp.assert_true(has_table_privilege('service_role','public.' || item.relname,'SELECT'), 'server read ' || item.relname);
    perform pg_temp.assert_true(not has_table_privilege('service_role','public.' || item.relname,'DELETE,TRUNCATE'), 'server destructive ACL ' || item.relname);
  end loop;
  perform pg_temp.assert_true(table_count=13, 'all thirteen tables');
  perform pg_temp.assert_true(not exists (select 1 from pg_policies where schemaname='public'), 'no policies on empty fixture database');
  perform pg_temp.assert_true((select count(*)=1 from public.publication_events where action='publication.settings_initialized'), 'installation audited');
  for item in select p.oid, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'publication\_%' escape '\' loop
    perform pg_temp.assert_true(not item.prosecdef, 'RPC invoker');
    perform pg_temp.assert_true(item.proconfig @> array['search_path=pg_catalog'], 'RPC explicit path');
    perform pg_temp.assert_true(not has_function_privilege('anon',item.oid,'EXECUTE'), 'anon RPC denied');
    perform pg_temp.assert_true(not has_function_privilege('authenticated',item.oid,'EXECUTE'), 'authenticated RPC denied');
    perform pg_temp.assert_true(has_function_privilege('service_role',item.oid,'EXECUTE'), 'server RPC enabled');
  end loop;
  perform pg_temp.assert_true(exists(select 1 from pg_indexes where indexname='publication_jobs_due_idx' and indexdef like '%WHERE%pending%'), 'pending jobs partial index');
  perform pg_temp.assert_true(exists(select 1 from pg_indexes where indexname='publication_deliveries_due_idx'), 'delivery due index');
  perform pg_temp.assert_true(exists(select 1 from pg_indexes where indexname='publication_events_resource_date_idx'), 'events index');
  perform pg_temp.assert_true(exists(select 1 from pg_indexes where indexname='publication_reviews_publication_revision_idx'), 'reviews index');
end $$;

set local role anon;
do $$ declare item record; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (c.relname like 'publication\_%' escape '\' or c.relname='publications') loop
  perform pg_temp.expect_failure(format('select * from public.%I',item.relname),'42501');
  perform pg_temp.expect_failure(format('insert into public.%I default values',item.relname),'42501');
 end loop;
end $$;
select pg_temp.expect_failure('select * from public.publications','42501');
select pg_temp.expect_failure('insert into public.publication_settings default values','42501');
select pg_temp.expect_failure($command$select public.publication_create_manual('11111111-1111-4111-8111-111111111111','2026-10-05',1::smallint,'Sujet','[]','user_admin')$command$,'42501');
reset role;
set local role authenticated;
do $$ declare item record; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (c.relname like 'publication\_%' escape '\' or c.relname='publications') loop
  perform pg_temp.expect_failure(format('select * from public.%I',item.relname),'42501');
  perform pg_temp.expect_failure(format('insert into public.%I default values',item.relname),'42501');
 end loop;
end $$;
select pg_temp.expect_failure('select * from public.publication_events','42501');
select pg_temp.expect_failure('select * from public.publication_settings','42501');
select pg_temp.expect_failure($command$select public.publication_revise_manual(gen_random_uuid(),gen_random_uuid(),'[]','user_admin')$command$,'42501');
reset role;

insert into public.clients(id,name) values
  ('11111111-1111-4111-8111-111111111111','Local client one'),
  ('22222222-2222-4222-8222-222222222222','Local client two');

set local role service_role;
do $$
declare client uuid := '11111111-1111-4111-8111-111111111111';
  other_client uuid := '22222222-2222-4222-8222-222222222222';
  publication uuid; second_publication uuid; revision uuid; next_revision uuid;
  variant uuid; other_variant uuid; asset uuid; account uuid; delivery uuid; job uuid;
  snapshot jsonb := '[{"platform":"facebook","text_content":"Local test"}]';
  publication_count integer; event_count integer; job_count integer;
begin
  perform pg_temp.assert_true((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings), 'safe initial flags');
  perform pg_temp.expect_failure('insert into public.publication_settings default values','23505');
  perform pg_temp.expect_failure('update public.publication_settings set publishing_enabled=true','23514');
  insert into public.publication_client_settings(client_id) values(client);
  perform pg_temp.assert_true((select timezone='Europe/Paris' and not generation_enabled and not publishing_enabled and jsonb_array_length(weekly_slots)=2 from public.publication_client_settings where client_id=client),'safe client settings');
  perform pg_temp.expect_failure(format('update public.publication_client_settings set timezone=%L where client_id=%L','Invalid/Zone',client),'23514');
  perform pg_temp.expect_failure(format('update public.publication_client_settings set weekly_slots=%L where client_id=%L','[{"day":2,"time":"10:00"}]',client),'23514');
  perform pg_temp.expect_failure(format('update public.publication_client_settings set weekly_slots=%L where client_id=%L','[{"day":2,"time":"10:00"},{"day":2,"time":"10:00"}]',client),'23514');

  publication := public.publication_create_manual(client,'2026-10-05',1::smallint,'Sujet',snapshot,'user_admin');
  second_publication := public.publication_create_manual(client,'2026-10-05',2::smallint,'Second sujet',snapshot,'user_admin');
  perform pg_temp.assert_true((select count(*)=2 from public.publications where client_id=client),'two slots');
  perform pg_temp.expect_failure(format('select public.publication_create_manual(%L,%L,1::smallint,%L,%L,%L)',client,'2026-10-05','Duplicate',snapshot,'user_admin'),'23505');
  perform pg_temp.expect_failure(format('select public.publication_create_manual(%L,%L,3::smallint,%L,%L,%L)',client,'2026-10-05','Third slot',snapshot,'user_admin'),'23514');
  perform pg_temp.expect_failure(format('select public.publication_create_manual(%L,%L,1::smallint,%L,%L,%L)',client,'2026-10-06','Not Monday',snapshot,'user_admin'),'23514');
  perform pg_temp.expect_failure(format('select public.publication_create_manual(%L,%L,1::smallint,%L,%L,%L)',gen_random_uuid(),'2026-10-12','Missing client',snapshot,'user_admin'),'23503');
  perform pg_temp.expect_failure(format('update public.publications set status=%L where id=%L','approved',publication),'23514');
  perform pg_temp.assert_true((select count(*)=2 from public.publication_events where action='publication.created' and client_id=client),'creation events');
  select current_revision_id into revision from public.publications where id=publication;
  select id into variant from public.publication_variants where revision_id=revision;
  select id into other_variant from public.publication_variants where publication_id=second_publication;
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,null,%L)',publication,revision,other_variant,'approved','user_admin'),'23503');
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,null,%L)',publication,revision,variant,'rejected','user_admin'),'23514');

  insert into public.publication_assets(client_id,storage_path,file_hash,mime_type,provenance)
    values(other_client,other_client::text || '/test.png',repeat('a',64),'image/png','test fixture') returning id into asset;
  perform pg_temp.expect_failure(format('insert into public.publication_variant_assets values(%L,%L,%L,0)',variant,asset,client),'23503');
  perform pg_temp.expect_failure(format('insert into public.publication_accounts(client_id,platform,metadata) values(%L,%L,%L)',client,'facebook','{"access_token":"forbidden"}'),'23514');
  insert into public.publication_accounts(client_id,platform,external_account_id) values(client,'facebook','local-page') returning id into account;
  perform pg_temp.assert_true((select not enabled and status='disconnected' and credential_reference is null from public.publication_accounts where id=account),'account disabled');
  perform pg_temp.expect_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key) values(%L,%L,%L,%L,%L,now(),%L)',publication,client,account,variant,'facebook','unapproved'),'23514');
  perform pg_temp.assert_true(public.publication_review(publication,revision,variant,'approved',null,'user_admin')='approved','approval');
  perform pg_temp.expect_failure(format('insert into public.publication_variants(revision_id,publication_id,client_id,platform,text_content) values(%L,%L,%L,%L,%L)',revision,publication,client,'instagram','New target'),'55000');
  perform pg_temp.expect_failure(format('update public.publication_variants set text_content=%L where id=%L','Changed',variant),'55000');
  perform pg_temp.expect_failure(format('insert into public.publication_variant_assets values(%L,%L,%L,0)',variant,asset,client),'55000');

  insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key)
    values(publication,client,account,variant,'facebook',now(),'one-logical-delivery') returning id into delivery;
  perform pg_temp.expect_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key) values(%L,%L,%L,%L,%L,now(),%L)',publication,client,account,variant,'facebook','second-key'),'23505');
  perform pg_temp.expect_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key,status) values(%L,%L,%L,%L,%L,now(),%L,%L)',second_publication,client,account,other_variant,'facebook','one-logical-delivery','blocked'),'23505');
  perform pg_temp.expect_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key,status) values(%L,%L,%L,%L,%L,now(),%L,%L)',second_publication,other_client,account,other_variant,'facebook','wrong-client','blocked'),'23503');
  perform pg_temp.expect_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key,status) values(%L,%L,%L,%L,%L,now(),%L,%L)',second_publication,client,account,other_variant,'instagram','wrong-platform','blocked'),'23503');
  perform pg_temp.expect_failure(format('insert into public.publication_jobs(type,publication_id,deduplication_key,attempts,max_attempts) values(%L,%L,%L,4,3)','generate',publication,'bad-attempts'),'23514');
  perform pg_temp.expect_failure(format('insert into public.publication_jobs(type,publication_id,deduplication_key,status) values(%L,%L,%L,%L)','generate',publication,'bad-lock','processing'),'23514');
  perform pg_temp.expect_failure(format('insert into public.publication_jobs(type,publication_id,deduplication_key) values(%L,%L,%L)','deliver',publication,'missing-delivery'),'23514');
  insert into public.publication_jobs(type,publication_id,delivery_id,deduplication_key) values('deliver',publication,delivery,'delivery-job') returning id into job;
  perform pg_temp.expect_failure(format('insert into public.publication_jobs(type,publication_id,delivery_id,deduplication_key) values(%L,%L,%L,%L)','deliver',second_publication,delivery,'wrong-job-context'),'23503');
  perform pg_temp.expect_failure(format('insert into public.publication_attempts(job_id,attempt_number,result) values(%L,1,%L)',job,'failed'),'23514');
  insert into public.publication_attempts(job_id,delivery_id,attempt_number,result) values(job,delivery,1,'failed');
  perform pg_temp.expect_failure(format('insert into public.publication_attempts(job_id,delivery_id,attempt_number,result) values(%L,%L,1,%L)',job,delivery,'failed'),'23505');

  perform pg_temp.expect_failure(format('select public.publication_revise_manual(%L,%L,%L,%L)',publication,gen_random_uuid(),snapshot,'user_admin'),'40001');
  next_revision := public.publication_revise_manual(publication,revision,'[{"platform":"facebook","text_content":"Revised text"},{"platform":"instagram","text_content":"New target"}]','user_admin');
  perform pg_temp.assert_true((select status='pending_review' and current_revision_id=next_revision from public.publications where id=publication),'new revision pending');
  perform pg_temp.assert_true(not exists(select 1 from public.publication_reviews where revision_id=next_revision),'no inherited approval');
  perform pg_temp.assert_true((select status='blocked' from public.publication_deliveries where id=delivery),'old delivery blocked');
  perform pg_temp.assert_true((select status='cancelled' from public.publication_jobs where id=job),'old job cancelled');
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,null,%L)',publication,revision,variant,'approved','user_admin'),'40001');
  select id into variant from public.publication_variants where revision_id=next_revision and platform='facebook';
  perform pg_temp.assert_true(public.publication_review(publication,next_revision,variant,'approved',null,'user_admin')='pending_review','partial platform approval');
  select id into variant from public.publication_variants where revision_id=next_revision and platform='instagram';
  perform pg_temp.assert_true(public.publication_review(publication,next_revision,variant,'rejected','Rewrite this','user_admin')='rejected','rejection');
  perform pg_temp.assert_true((select count(*)=1 from public.publication_jobs where revision_id=next_revision and type='regenerate' and status='pending'),'one inactive regeneration job');
  perform pg_temp.assert_true((select not generation_enabled and not automation_enabled and emergency_stop from public.publication_settings),'refusal does not activate automation');
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,%L,%L)',publication,next_revision,variant,'rejected','Again','user_admin'),'40001');

  -- Invalid snapshot rolls back parent insert, revision and event together.
  select count(*) into publication_count from public.publications;
  select count(*) into event_count from public.publication_events;
  perform pg_temp.expect_failure(format('select public.publication_create_manual(%L,%L,1::smallint,%L,%L,%L)',client,'2026-10-12','Invalid snapshot','[{"platform":"facebook","text_content":"x","token":"secret"}]','user_admin'),'22023');
  perform pg_temp.assert_true((select count(*)=publication_count from public.publications),'invalid snapshot rollback');
  perform pg_temp.assert_true((select count(*)=event_count from public.publication_events),'invalid event rollback');
  select count(*) into job_count from public.publication_jobs;
  perform pg_temp.assert_true(job_count=2,'no duplicate regeneration job');
end $$;
reset role;

-- Owner-level trigger tests prove append-only beyond TypeScript and grants.
select pg_temp.expect_failure('update public.publication_events set action=''publication.changed''','55000');
select pg_temp.expect_failure('delete from public.publication_events','55000');
select pg_temp.expect_failure('truncate public.publication_events','55000');
select pg_temp.expect_failure('update public.publication_reviews set decision=''rejected''','55000');
select pg_temp.expect_failure('delete from public.publication_revisions','55000');
select pg_temp.expect_failure('delete from public.clients where id=''11111111-1111-4111-8111-111111111111''','23503');

create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin raise exception 'Injected audit failure' using errcode='55000'; end $$;
create trigger test_fail_audit before insert on public.publication_events for each row execute function pg_temp.fail_audit();
do $$
declare publication_count integer; revision_count integer; event_count integer; jobs_count integer;
  publication uuid; revision uuid; variant uuid;
begin
  select count(*) into publication_count from public.publications;
  select count(*) into revision_count from public.publication_revisions;
  select count(*) into event_count from public.publication_events;
  select count(*) into jobs_count from public.publication_jobs;
  perform pg_temp.expect_failure($command$select public.publication_create_manual('11111111-1111-4111-8111-111111111111','2026-10-12',1::smallint,'Must rollback','[{"platform":"facebook","text_content":"local"}]','user_admin')$command$,'55000');
  select id,current_revision_id into publication,revision from public.publications where slot=2;
  select id into variant from public.publication_variants where revision_id=revision;
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,%L,%L)',publication,revision,variant,'rejected','Must rollback','user_admin'),'55000');
  perform pg_temp.assert_true((select count(*)=publication_count from public.publications),'audit failure rolls back publication');
  perform pg_temp.assert_true((select count(*)=revision_count from public.publication_revisions),'audit failure rolls back revision');
  perform pg_temp.assert_true((select count(*)=event_count from public.publication_events),'audit failure leaves events unchanged');
  perform pg_temp.assert_true((select count(*)=jobs_count from public.publication_jobs),'audit failure rolls back regeneration job');
  perform pg_temp.assert_true(not exists(select 1 from public.publication_reviews where revision_id=revision),'audit failure rolls back review');
  perform pg_temp.assert_true((select status='pending_review' from public.publications where id=publication),'audit failure rolls back status');
end $$;
drop trigger test_fail_audit on public.publication_events;

-- Job creation itself must also be atomic with review and audit.
create function pg_temp.fail_job() returns trigger language plpgsql as $$
begin raise exception 'Injected job failure' using errcode='55000'; end $$;
create trigger test_fail_job before insert on public.publication_jobs for each row execute function pg_temp.fail_job();
set local role service_role;
do $$
declare publication uuid; revision uuid; variant uuid; reviews_count integer; events_count integer; jobs_count integer;
begin
  select id,current_revision_id into publication,revision from public.publications where slot=2;
  select id into variant from public.publication_variants where revision_id=revision;
  select count(*) into reviews_count from public.publication_reviews;
  select count(*) into events_count from public.publication_events;
  select count(*) into jobs_count from public.publication_jobs;
  perform pg_temp.expect_failure(format('select public.publication_review(%L,%L,%L,%L,%L,%L)',publication,revision,variant,'rejected','Must rollback after job failure','user_admin'),'55000');
  perform pg_temp.assert_true((select count(*)=reviews_count from public.publication_reviews),'job failure rolls back review');
  perform pg_temp.assert_true((select count(*)=events_count from public.publication_events),'job failure leaves audit unchanged');
  perform pg_temp.assert_true((select count(*)=jobs_count from public.publication_jobs),'job failure leaves queue unchanged');
  perform pg_temp.assert_true((select status='pending_review' and current_revision_id=revision from public.publications where id=publication),'job failure preserves status and revision');
end $$;
reset role;
drop trigger test_fail_job on public.publication_jobs;
