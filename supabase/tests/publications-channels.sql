-- Synthetic PostgreSQL local test only (Lot 4.3 P1). Never execute on a remote project.
-- Runs after the P1 migration on a rebuilt local database. Fixtures use runtime UUIDs (no known identifier).
create temporary table p1_ids(name text primary key,id uuid not null);
grant select,insert,update on p1_ids to service_role;

-- 1. Structure, RLS, grants, functions.
select pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_project_channels'::regclass),'channels RLS enabled');
select pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename='publication_project_channels'),'channels without policy');
do $$declare r text;f text;begin
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_project_channels','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'browser table privileges absent');
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_project_channels','SELECT,INSERT,UPDATE'),'server select/insert/update');
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_project_channels','DELETE'),'server delete denied');
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_project_channels','TRUNCATE'),'server truncate denied');
 foreach f in array array['public.publication_channel_save(uuid,text,boolean,uuid,text,text)','publications_private.project_publications_eligible(text)',
  'publications_private.legacy_type_platforms(text)','publications_private.guard_project_channel()','publications_private.materialize_legacy_channels(uuid[],text,text,text)',
  'publications_private.backfill_legacy_channels()','publications_private.project_platform_allowed(uuid,uuid,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);
  end loop;
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 foreach f in array array['public.publication_channel_save(uuid,text,boolean,uuid,text,text)','publications_private.project_publications_eligible(text)',
  'publications_private.legacy_type_platforms(text)','publications_private.guard_project_channel()','publications_private.materialize_legacy_channels(uuid[],text,text,text)',
  'publications_private.project_platform_allowed(uuid,uuid,text)'] loop
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
 end loop;
 perform pg_temp.replay_assert(not has_function_privilege('service_role','publications_private.backfill_legacy_channels()','EXECUTE'),'backfill owner only');
end $$;
select pg_temp.replay_assert((select proacl::text from pg_proc where oid='publications_private.project_platform_allowed(uuid,uuid,text)'::regprocedure)
 is not distinct from (select acl from p1_before_allowed_acl),'project_platform_allowed ACL unchanged');
create temporary view p1_event_contract_now as
 select 'constraint' kind,conname::text name,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.publication_events'::regclass
 union all select 'trigger',tgname::text,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.publication_events'::regclass and not tgisinternal
 union all select 'column',attname::text,format_type(atttypid,atttypmod)||coalesce(' default '||pg_get_expr(d.adbin,d.adrelid),'')||case when attnotnull then ' not null' else '' end
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.publication_events'::regclass and a.attnum>0 and not a.attisdropped;
select pg_temp.replay_assert((select count(*) from p1_before_event_contract)>0 and not exists((select * from p1_before_event_contract) except (select * from p1_event_contract_now))
 and not exists((select * from p1_event_contract_now) except (select * from p1_before_event_contract)),'publication_events contract unchanged');
set local role anon;
select pg_temp.replay_failure('select * from public.publication_project_channels','42501','actual anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_channel_save(null,''facebook'',true,null,null,''user_local'')','42501','actual authenticated RPC denied');
set local role service_role;
select pg_temp.replay_failure('select publications_private.backfill_legacy_channels()','42501','server cannot run the backfill');
select pg_temp.replay_failure('delete from public.publication_project_channels','42501','server delete denied at runtime');
reset role;

-- 2. Initial backfill (ran inside the migration): exactly the legacy set of every eligible project, audited as system.
select pg_temp.replay_assert((select count(*)>0 from p1_expected),'fixtures contain eligible historical projects');
select pg_temp.replay_assert(not exists((select project_id,client_id,platform from p1_expected) except (select project_id,client_id,platform from public.publication_project_channels))
 and not exists((select project_id,client_id,platform from public.publication_project_channels) except (select project_id,client_id,platform from p1_expected)),'backfill rows = expected legacy rows');
select pg_temp.replay_assert((select bool_and(enabled and publication_account_id is null and editorial_rules is null) from public.publication_project_channels),'backfilled rows enabled, no account, no rules');
select pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.channel_configured' and metadata->>'source'='legacy_backfill'
 and actor_type='system' and actor_id is null and resource_type='project_channel')=(select count(*) from p1_expected),'one system event per backfilled row');
select pg_temp.replay_assert((select count(*) from public.publication_events)=(select n from p1_before_events)+(select count(*) from p1_expected),'backfill wrote only its events');
select pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels c join public.projects p on p.id=c.project_id
 where not publications_private.project_publications_eligible(p.type)),'non-eligible projects have no channel');
-- Existing publications unchanged by the migration.
select pg_temp.replay_assert((select count(*) from p1_before_publications)=(select count(*) from public.publications)
 and not exists((select v from p1_before_publications) except (select to_jsonb(p) from public.publications p)),'publications unchanged');
select pg_temp.replay_assert((select count(*) from p1_before_revisions)=(select count(*) from public.publication_revisions)
 and not exists((select v from p1_before_revisions) except (select to_jsonb(r) from public.publication_revisions r)),'revisions unchanged');
select pg_temp.replay_assert((select count(*) from p1_before_variants)=(select count(*) from public.publication_variants)
 and not exists((select v from p1_before_variants) except (select to_jsonb(v) from public.publication_variants v)),'variants unchanged');
-- Every current variant of a scoped publication is still allowed after the backfill.
select pg_temp.replay_assert(not exists(select 1 from public.publication_variants v join public.publications p on p.current_revision_id=v.revision_id
 join public.publication_revisions r on r.id=v.revision_id
 where not publications_private.project_platform_allowed(r.project_id,v.client_id,v.platform)),'historical current variants remain allowed');

-- 3. Backfill replay, custom project ignored, project created between two backfills (owner only).
select pg_temp.replay_assert(not exists(select 1 from public.projects p where publications_private.project_publications_eligible(p.type)
 and not exists(select 1 from public.publication_project_channels c where c.project_id=p.id)),'no pending candidate after migration');
do $$
declare cl uuid:=gen_random_uuid();legacy_p uuid:=gen_random_uuid();custom_p uuid:=gen_random_uuid();late_p uuid:=gen_random_uuid();
 before_custom jsonb;before_legacy jsonb;events_before bigint;rows_before bigint;n integer;
begin
 insert into public.clients(id,name) values(cl,'P1 backfill fixture');
 insert into public.projects(id,client_id,name,type) values(legacy_p,cl,'Legacy candidate','Réseaux sociaux'),(custom_p,cl,'Custom configured','Google Business Profile');
 -- Custom configuration BEFORE the backfill, completely different from its legacy set (GBP absent, FB disabled).
 insert into public.publication_project_channels(client_id,project_id,platform,enabled) values(cl,custom_p,'facebook',false),(cl,custom_p,'instagram',true);
 select jsonb_agg(to_jsonb(c) order by c.platform) into before_custom from public.publication_project_channels c where c.project_id=custom_p;
 select count(*) into events_before from public.publication_events;
 n:=publications_private.backfill_legacy_channels();
 perform pg_temp.replay_assert(n=2,'only the legacy candidate is backfilled (FB+IG)');
 perform pg_temp.replay_assert((select array_agg(platform order by platform) from public.publication_project_channels
  where project_id=legacy_p and enabled and publication_account_id is null and editorial_rules is null)=array['facebook','instagram'],'candidate gets exactly its legacy set');
 perform pg_temp.replay_assert((select jsonb_agg(to_jsonb(c) order by c.platform) from public.publication_project_channels c where c.project_id=custom_p)=before_custom,'custom project untouched');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels where project_id=custom_p and platform='google_business_profile'),'custom project never completed');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events_before+2
  and not exists(select 1 from public.publication_events where metadata->>'project_id'=custom_p::text),'events only for the candidate');
 -- Second pass: zero candidate, no row, no event, no error.
 select count(*) into events_before from public.publication_events;select count(*) into rows_before from public.publication_project_channels;
 select jsonb_agg(to_jsonb(c) order by c.platform) into before_legacy from public.publication_project_channels c where c.project_id=legacy_p;
 n:=publications_private.backfill_legacy_channels();
 perform pg_temp.replay_assert(n=0,'second backfill creates nothing');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events_before and (select count(*) from public.publication_project_channels)=rows_before,'second backfill: no row, no event');
 perform pg_temp.replay_assert((select jsonb_agg(to_jsonb(c) order by c.platform) from public.publication_project_channels c where c.project_id=custom_p)=before_custom
  and (select jsonb_agg(to_jsonb(c) order by c.platform) from public.publication_project_channels c where c.project_id=legacy_p)=before_legacy,'configured projects intact after replay');
 -- A project created between two backfills is the only candidate.
 insert into public.projects(id,client_id,name,type) values(late_p,cl,'Late project','Google Business Profile');
 n:=publications_private.backfill_legacy_channels();
 perform pg_temp.replay_assert(n=1 and (select array_agg(platform) from public.publication_project_channels where project_id=late_p)=array['google_business_profile'],'late project alone backfilled');
 perform pg_temp.replay_assert((select count(*) from public.publication_project_channels)=rows_before+1,'nothing else touched by the late backfill');
end $$;

-- Fixtures for the RPC scenarios (all unconfigured, i.e. on the legacy fallback).
do $$
declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();
begin
 insert into public.clients(id,name) values(cl,'P1 channels fixture'),(other,'P1 other client');
 insert into p1_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('gbp',gen_random_uuid()),('web',gen_random_uuid()),
  ('zero',gen_random_uuid()),('first_save',gen_random_uuid()),('legacy_pub',gen_random_uuid()),('calendar',gen_random_uuid()),('other_project',gen_random_uuid()),
  ('account_fb',gen_random_uuid()),('account_other_client',gen_random_uuid()),('account_ig',gen_random_uuid());
 insert into public.projects(id,client_id,name,type)
 select (select id from p1_ids where name=n),cl,'P1 '||n,t from (values('social','Réseaux sociaux'),('gbp','Google Business Profile'),('web','Site web'),
  ('zero','Réseaux sociaux'),('first_save','Réseaux sociaux'),('legacy_pub','Réseaux sociaux'),('calendar','Réseaux sociaux')) v(n,t);
 insert into public.projects(id,client_id,name,type) values((select id from p1_ids where name='other_project'),other,'P1 other project','Réseaux sociaux');
 -- Accounts carry an external id and a credential reference that must never reach the audit.
 insert into public.publication_accounts(id,client_id,platform,external_account_id,credential_reference) values
  ((select id from p1_ids where name='account_fb'),cl,'facebook','p1-external-secret-id','ref:p1/credential-secret'),
  ((select id from p1_ids where name='account_other_client'),other,'facebook','p1-external-other','ref:p1/other-secret'),
  ((select id from p1_ids where name='account_ig'),cl,'instagram','p1-external-ig','ref:p1/ig-secret');
end $$;

-- 4. Legacy fallback (no row) and NULL project.
do $$
declare cl uuid:=(select id from p1_ids where name='client');s uuid:=(select id from p1_ids where name='social');g uuid:=(select id from p1_ids where name='gbp');w uuid:=(select id from p1_ids where name='web');
begin
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(s,cl,'facebook') and publications_private.project_platform_allowed(s,cl,'instagram')
  and not publications_private.project_platform_allowed(s,cl,'google_business_profile'),'social fallback: FB+IG only');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(g,cl,'google_business_profile') and not publications_private.project_platform_allowed(g,cl,'facebook'),'GBP fallback: GBP only');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(w,cl,'facebook') and not publications_private.project_platform_allowed(w,cl,'google_business_profile'),'non-eligible: nothing');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(s,(select id from p1_ids where name='other_client'),'facebook'),'cross-client denied');
 perform pg_temp.replay_assert(not coalesce(publications_private.project_platform_allowed(s,cl,null),false) and not publications_private.project_platform_allowed(s,null,'facebook'),'NULL client/platform denied');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(null,cl,'facebook'),'unscoped historical content unchanged');
end $$;

-- 5. RPC validation and integrity (service_role).
set local role service_role;
do $$
declare s uuid:=(select id from p1_ids where name='social');g uuid:=(select id from p1_ids where name='gbp');w uuid:=(select id from p1_ids where name='web');
begin
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''tiktok'',true,null,null,''user_local'')',g),'22023','unknown platform');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,null,true,null,null,''user_local'')',g),'22023','NULL platform');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',null,null,null,''user_local'')',g),'22023','NULL enabled');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,null,''admin'')',g),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,null,null)',g),'22023','NULL actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,%L,''user_local'')',g,repeat('x',4001)),'22023','rules too long');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,%L,''user_local'')',g,'bad'||chr(1)),'22023','control character in rules');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,null,''user_local'')',gen_random_uuid()),'23514','unknown project');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,null,null,''user_local'')',w),'23514','non-eligible project (transitional guard)');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,%L,null,''user_local'')',g,(select id from p1_ids where name='account_other_client')),'23514','account of another client');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''facebook'',true,%L,null,''user_local'')',g,(select id from p1_ids where name='account_ig')),'23514','account of another platform');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels where project_id in(s,g,w)),'refusals left no row');
end $$;
reset role;

-- 6. Scenario 1: Réseaux sociaux -> +GBP -> FB/IG disabled -> GBP disabled (0 active, no fallback).
set local role service_role;
do $$
declare cl uuid:=(select id from p1_ids where name='client');s uuid:=(select id from p1_ids where name='social');saved uuid;events_before bigint;
begin
 select count(*) into events_before from public.publication_events where client_id=cl;
 saved:=public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local');
 perform pg_temp.replay_assert((select array_agg(platform order by platform) from public.publication_project_channels where project_id=s and enabled)
  =array['facebook','google_business_profile','instagram'],'social + GBP: FB, IG and GBP enabled');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where client_id=cl and metadata->>'project_id'=s::text and metadata->>'source'='legacy_materialized' and actor_type='admin' and actor_id='user_local')=2,'FB/IG materialized (admin)');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where resource_id=saved and metadata->>'source'='admin' and metadata->>'created'='true' and before_data is null)=1,'GBP created by admin');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where client_id=cl)=events_before+3,'three events');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(s,cl,'facebook') and publications_private.project_platform_allowed(s,cl,'instagram')
  and publications_private.project_platform_allowed(s,cl,'google_business_profile'),'allowed: FB, IG, GBP');
 perform public.publication_channel_save(s,'facebook',false,null,null,'user_local');
 perform public.publication_channel_save(s,'instagram',false,null,null,'user_local');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(s,cl,'facebook') and not publications_private.project_platform_allowed(s,cl,'instagram')
  and publications_private.project_platform_allowed(s,cl,'google_business_profile'),'GBP only, no FB/IG fallback');
 perform public.publication_channel_save(s,'google_business_profile',false,null,null,'user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_project_channels where project_id=s)=3
  and not exists(select 1 from public.publication_project_channels where project_id=s and enabled),'0 active channel, project still configured');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(s,cl,'facebook') and not publications_private.project_platform_allowed(s,cl,'instagram')
  and not publications_private.project_platform_allowed(s,cl,'google_business_profile'),'nothing allowed, no fallback');
 -- created_at is the transaction time here: the disabling event is identified by its content, not its order.
 perform pg_temp.replay_assert((select count(*) from public.publication_events where client_id=cl and metadata->>'platform'='google_business_profile'
  and metadata->>'project_id'=s::text and metadata->>'source'='admin' and metadata->>'created'='false'
  and before_data->>'enabled'='true' and after_data->>'enabled'='false')=1,'last channel disabled and audited');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(null,null,%L,%L,''T'',''A'',''S'',''2027-05-03'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',cl,s),'23514','suspended project: new variant refused');
 -- Re-enabling one channel enables only that one.
 perform public.publication_channel_save(s,'instagram',true,null,null,'user_local');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(s,cl,'instagram') and not publications_private.project_platform_allowed(s,cl,'facebook')
  and not publications_private.project_platform_allowed(s,cl,'google_business_profile'),'re-enable one: only that one');
end $$;

-- 7. Scenario 2: Google Business Profile -> +Facebook.
do $$
declare cl uuid:=(select id from p1_ids where name='client');g uuid:=(select id from p1_ids where name='gbp');
begin
 perform public.publication_channel_save(g,'facebook',true,null,null,'user_local');
 perform pg_temp.replay_assert((select array_agg(platform order by platform) from public.publication_project_channels where project_id=g and enabled)=array['facebook','google_business_profile'],'GBP + FB');
 perform pg_temp.replay_assert((select metadata->>'source' from public.publication_events where client_id=cl and metadata->>'project_id'=g::text and metadata->>'platform'='google_business_profile')='legacy_materialized','GBP materialized');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(g,cl,'facebook') and publications_private.project_platform_allowed(g,cl,'google_business_profile')
  and not publications_private.project_platform_allowed(g,cl,'instagram'),'allowed: GBP + FB, not IG');
 -- Account assignment and rules (audited as booleans only).
 perform public.publication_channel_save(g,'facebook',true,(select id from p1_ids where name='account_fb'),'  Ton chaleureux  ','user_local');
 perform pg_temp.replay_assert((select publication_account_id=(select id from p1_ids where name='account_fb') and editorial_rules='Ton chaleureux' from public.publication_project_channels
  where project_id=g and platform='facebook'),'account and trimmed rules saved');
 perform public.publication_channel_save(g,'facebook',true,null,'   ','user_local');
 perform pg_temp.replay_assert((select publication_account_id is null and editorial_rules is null from public.publication_project_channels where project_id=g and platform='facebook'),'blank rules stored as NULL, account cleared');
end $$;

-- 8. Zero active with two configured channels; first save materialization (existing legacy platform).
do $$
declare cl uuid:=(select id from p1_ids where name='client');z uuid:=(select id from p1_ids where name='zero');f uuid:=(select id from p1_ids where name='first_save');saved uuid;
begin
 perform public.publication_channel_save(z,'facebook',false,null,null,'user_local');
 perform public.publication_channel_save(z,'instagram',false,null,null,'user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_project_channels where project_id=z)=2 and not exists(select 1 from public.publication_project_channels where project_id=z and enabled),'two configured disabled channels');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(z,cl,'facebook'),'FB not allowed');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(z,cl,'instagram'),'IG not allowed (fallback does not return)');
 perform pg_temp.replay_assert(not publications_private.project_platform_allowed(z,cl,'google_business_profile'),'GBP not allowed');
 saved:=public.publication_channel_save(f,'facebook',false,null,null,'user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_project_channels where project_id=f)=2,'first save materializes FB+IG');
 perform pg_temp.replay_assert((select enabled from public.publication_project_channels where project_id=f and platform='instagram'),'IG kept enabled');
 perform pg_temp.replay_assert(not (select enabled from public.publication_project_channels where id=saved),'FB disabled');
 perform pg_temp.replay_assert((select before_data->>'enabled'='true' and after_data->>'enabled'='false' and metadata->>'created'='false' from public.publication_events
  where resource_id=saved and metadata->>'source'='admin'),'update of a materialized channel audited with its previous state');
end $$;
reset role;

-- 9. Direct writes: integrity and immutability (owner bypasses grants, not constraints/triggers).
do $$
declare cl uuid:=(select id from p1_ids where name='client');other uuid:=(select id from p1_ids where name='other_client');g uuid:=(select id from p1_ids where name='gbp');w uuid:=(select id from p1_ids where name='web');ch uuid;
begin
 select id into ch from public.publication_project_channels where project_id=g and platform='facebook';
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform) values(%L,%L,''tiktok'')',cl,w),'23514','direct unknown platform');
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform) values(%L,%L,''facebook'')',other,w),'23503','direct project of another client');
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform,publication_account_id) values(%L,%L,''facebook'',%L)',cl,w,(select id from p1_ids where name='account_other_client')),'23503','direct account of another client');
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform,publication_account_id) values(%L,%L,''facebook'',%L)',cl,w,(select id from p1_ids where name='account_ig')),'23503','direct account of another platform');
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform) values(%L,%L,''facebook'')',cl,g),'23505','duplicate project/platform');
 perform pg_temp.replay_failure(format('insert into public.publication_project_channels(client_id,project_id,platform,editorial_rules) values(%L,%L,''facebook'','' '')',cl,w),'23514','direct blank rules');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set platform=''instagram'' where id=%L',ch),'55000','platform immutable');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set project_id=%L where id=%L',w,ch),'55000','project immutable');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set client_id=%L where id=%L',other,ch),'55000','client immutable');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set created_at=now()-interval ''1 day'' where id=%L',ch),'55000','created_at immutable');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set id=gen_random_uuid() where id=%L',ch),'55000','id immutable');
 perform pg_temp.replay_failure(format('delete from public.publication_project_channels where id=%L',ch),'55000','delete refused for owner');
 perform pg_temp.replay_failure('truncate public.publication_project_channels','55000','truncate refused for owner');
 perform pg_temp.replay_failure(format('delete from public.projects where id=%L',g),'23503','configured project cannot be deleted');
end $$;

-- 10. Legacy publications: adding GBP keeps FB+IG revisable; disabling IG blocks a new FB+IG revision, history intact.
set local role service_role;
do $$
declare cl uuid:=(select id from p1_ids where name='client');lp uuid:=(select id from p1_ids where name='legacy_pub');pub uuid;rev uuid;rev2 uuid;snapshot jsonb;
begin
 pub:=public.publication_save_draft(null,null,cl,lp,'Legacy FB+IG','A','S','2027-06-07',null,null,'[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_channel_save(lp,'google_business_profile',true,null,null,'user_local');
 rev2:=public.publication_save_draft(pub,rev,cl,lp,'Legacy FB+IG','A2','S','2027-06-07',null,null,'[{"platform":"facebook","text_content":"F2"},{"platform":"instagram","text_content":"I2"}]','user_local');
 select current_revision_id into rev2 from public.publications where id=pub;
 perform pg_temp.replay_assert(rev2<>rev,'adding GBP keeps the FB+IG publication revisable');
 perform public.publication_channel_save(lp,'instagram',false,null,null,'user_local');
 select jsonb_build_object('p',(select to_jsonb(p) from public.publications p where id=pub),
  'r',(select jsonb_agg(to_jsonb(r) order by r.id) from public.publication_revisions r where publication_id=pub),
  'v',(select jsonb_agg(to_jsonb(v) order by v.id) from public.publication_variants v where publication_id=pub),
  'e',(select count(*) from public.publication_events where resource_id=pub)) into snapshot;
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''Legacy FB+IG'',''A3'',''S'',''2027-06-07'',null,null,''[{"platform":"facebook","text_content":"F3"},{"platform":"instagram","text_content":"I3"}]'',''user_local'')',pub,rev2,cl,lp),'23514','IG disabled: new FB+IG revision refused');
 perform pg_temp.replay_assert(snapshot=jsonb_build_object('p',(select to_jsonb(p) from public.publications p where id=pub),
  'r',(select jsonb_agg(to_jsonb(r) order by r.id) from public.publication_revisions r where publication_id=pub),
  'v',(select jsonb_agg(to_jsonb(v) order by v.id) from public.publication_variants v where publication_id=pub),
  'e',(select count(*) from public.publication_events where resource_id=pub)),'publication, history and audit intact after refusal');
 perform pg_temp.replay_assert(not (select enabled from public.publication_project_channels where project_id=lp and platform='instagram'),'IG never re-enabled automatically');
end $$;

-- 11. Legacy calendar is not multi-channel: SQL safety net refuses slots for a non-aligned configuration.
do $$
declare c uuid:=(select id from p1_ids where name='calendar');config jsonb:='{"enabled":true,"posts_per_week":2,"preferred_weekdays":[1,5],"preferred_times":["12:00","12:00"],"timezone":"Europe/Paris","planning_horizon_weeks":4,"auto_create_slots":true,"require_manual_approval":true}';
begin
 perform public.publication_save_cadence(c,config,'user_local');
 perform public.publication_channel_save(c,'facebook',false,null,null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_ensure_calendar(%L,''2027-07-05'',true,''user_local'')',c),'23514','non-aligned project: legacy slots refused');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_calendar_slots where project_id=c),'no slot created');
end $$;
reset role;

-- 12. Audit never contains account identifiers, credentials, tokens or secrets.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.channel_configured' and resource_type<>'project_channel'),'channel events typed project_channel');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.channel_configured' and (
 coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(external_account_id|credential_reference|token|secret|p1-external|ref:p1)'),'audit without account identifiers or secrets');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events e where e.action='publication.channel_configured' and (
 exists(select 1 from jsonb_object_keys(e.metadata) k where k not in('project_id','platform','created','source'))
 or exists(select 1 from jsonb_object_keys(coalesce(e.after_data,'{}')) k where k not in('enabled','has_account','has_rules'))
 or exists(select 1 from jsonb_object_keys(coalesce(e.before_data,'{}')) k where k not in('enabled','has_account','has_rules')))),'audit keys bounded');
select pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.channel_configured' and after_data->>'has_account'='true'),'account assignment audited as a boolean');

-- 13. materialize_legacy_channels provenance guard (empty project set: no side effect).
set local role service_role;
do $$begin
 perform pg_temp.replay_assert(publications_private.materialize_legacy_channels(array[]::uuid[],'admin','user_test','legacy_materialized')=0,'admin + legacy_materialized + Clerk id accepted');
 perform pg_temp.replay_assert(publications_private.materialize_legacy_channels(array[]::uuid[],'system',null,'legacy_backfill')=0,'system + legacy_backfill + NULL accepted');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''admin'',null,''legacy_materialized'')','22023','admin without actor refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''admin'',''invalid'',''legacy_materialized'')','22023','admin with invalid actor refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''system'',''user_test'',''legacy_backfill'')','22023','system with actor refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''admin'',''user_test'',''legacy_backfill'')','22023','admin + backfill source refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''system'',null,''legacy_materialized'')','22023','system + materialized source refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],null,''user_test'',''legacy_materialized'')','22023','NULL actor type refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''admin'',''user_test'',null)','22023','NULL source refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(null,''admin'',''user_test'',''legacy_materialized'')','22023','NULL project set refused');
 perform pg_temp.replay_failure('select publications_private.materialize_legacy_channels(array[]::uuid[],''worker'',null,''legacy_backfill'')','22023','worker refused');
end $$;
reset role;

-- 14. Atomicity: failure injected AFTER materialization (on the final admin audit insert). Test-only trigger.
create schema p1_test_injection;
create function p1_test_injection.fail_admin_channel_event() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after materialization' using errcode='P0001'; end $$;
grant usage on schema p1_test_injection to service_role;
grant execute on function p1_test_injection.fail_admin_channel_event() to service_role;
create trigger p1_inject_after_materialize before insert on public.publication_events for each row
 when (new.action='publication.channel_configured' and new.metadata->>'source'='admin')
 execute function p1_test_injection.fail_admin_channel_event();
do $$declare cl uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P1 atomicity fixture');
 insert into public.projects(id,client_id,name,type) values(pr,cl,'Unconfigured social','Réseaux sociaux');
 insert into p1_ids values('atomic_client',cl),('atomic_project',pr);
end $$;
set local role service_role;
do $$declare cl uuid:=(select id from p1_ids where name='atomic_client');pr uuid:=(select id from p1_ids where name='atomic_project');begin
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''google_business_profile'',true,null,null,''user_p1_atomicity'')',pr),'P0001','injected failure after materialization');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels where project_id=pr),'0 channel persisted');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_events where client_id=cl),'0 event persisted');
 perform pg_temp.replay_assert(publications_private.project_platform_allowed(pr,cl,'instagram') and not publications_private.project_platform_allowed(pr,cl,'google_business_profile'),'project still on legacy fallback');
end $$;
reset role;
drop trigger p1_inject_after_materialize on public.publication_events;
drop schema p1_test_injection cascade;
select pg_temp.replay_assert(not exists(select 1 from pg_trigger where tgname='p1_inject_after_materialize') and to_regnamespace('p1_test_injection') is null,'injection removed');
set local role service_role;
do $$declare cl uuid:=(select id from p1_ids where name='atomic_client');pr uuid:=(select id from p1_ids where name='atomic_project');begin
 perform public.publication_channel_save(pr,'google_business_profile',true,null,null,'user_p1_atomicity');
 perform pg_temp.replay_assert((select count(*) from public.publication_project_channels where project_id=pr)=3 and (select count(*) from public.publication_events where client_id=cl)=3,'control run: 3 rows, 3 events');
end $$;
reset role;

-- 15. Backfill fail-closed paths (test-only injections; every effect rolled back by the failing call).
create schema p1_test_injection;
create function p1_test_injection.disable_on_insert() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.enabled:=false; return new; end $$;
create function p1_test_injection.skip_insert() returns trigger language plpgsql set search_path=pg_catalog as $$
begin return null; end $$;
do $$declare cl uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();events_before bigint;begin
 insert into public.clients(id,name) values(cl,'P1 backfill failure fixture');
 insert into public.projects(id,client_id,name,type) values(pr,cl,'Backfill failure','Google Business Profile');
 select count(*) into events_before from public.publication_events;
 execute format('create trigger p1_inject_disable before insert on public.publication_project_channels for each row when (new.project_id=%L) execute function p1_test_injection.disable_on_insert()',pr);
 perform pg_temp.replay_failure('select publications_private.backfill_legacy_channels()','P0001','post-condition failure detected');
 drop trigger p1_inject_disable on public.publication_project_channels;
 execute format('create trigger p1_inject_skip before insert on public.publication_project_channels for each row when (new.project_id=%L) execute function p1_test_injection.skip_insert()',pr);
 perform pg_temp.replay_failure('select publications_private.backfill_legacy_channels()','P0001','row count mismatch detected');
 drop trigger p1_inject_skip on public.publication_project_channels;
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels where project_id=pr) and (select count(*) from public.publication_events)=events_before,'failed backfills left no state');
 -- Every still-unconfigured eligible project (this one and earlier never-configured fixtures) is a candidate.
 select count(*) into events_before from public.projects p cross join lateral unnest(publications_private.legacy_type_platforms(p.type))
  where not exists(select 1 from public.publication_project_channels c where c.project_id=p.id);
 -- Separate statements: the check must see the rows inserted by the backfill call.
 perform pg_temp.replay_assert(events_before>=1 and publications_private.backfill_legacy_channels()=events_before,'clean backfill succeeds afterwards');
 perform pg_temp.replay_assert((select array_agg(platform) from public.publication_project_channels where project_id=pr)=array['google_business_profile'],'failed project backfilled cleanly');
end $$;
drop schema p1_test_injection cascade;

-- 16. Global safety: no delivery, job or settings change.
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries),'no deliveries');
select pg_temp.replay_assert(not exists(select 1 from public.publication_jobs),'no external jobs');
