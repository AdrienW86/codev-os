-- Synthetic PostgreSQL local test only (Lot 4.3 P11-a). Never execute on a remote project.
-- Runs after P1 … P10 and the P11 migration on a rebuilt local database.
create temporary table p11_ids(name text primary key,id uuid not null);
grant select,insert,update on p11_ids to service_role;
create function pg_temp.p11_hash(p text) returns text language sql as $$ select encode(sha256(convert_to(p,'UTF8')),'hex') $$;
create function pg_temp.p11_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
grant execute on function pg_temp.p11_hash(text),pg_temp.p11_error(text) to service_role;
create temporary table p11_before as select jsonb_build_object('events',(select count(*) from public.publication_events),
 'connections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.client_connections c),'accounts',(select count(*) from public.publication_accounts),
 'publications',(select count(*) from public.publications),'deliveries',(select count(*) from public.publication_deliveries)) v;

-- 1. Grants, RLS, function properties, browser denial.
do $$declare r text;f text;t text;begin
 foreach t in array array['public.publication_credential_secrets','public.publication_oauth_states'] loop
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS '||t);
  perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename=split_part(t,'.',2)),'no policy '||t);
  foreach r in array array['anon','authenticated'] loop perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser privileges absent '||t||' '||r);end loop;
  perform pg_temp.replay_assert(not has_table_privilege('service_role',t,'TRUNCATE'),'server never truncates '||t);
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_credential_secrets','SELECT,INSERT,DELETE') and not has_table_privilege('service_role','public.publication_credential_secrets','UPDATE'),'vault: server select / insert / delete, never update');
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_oauth_states','SELECT,INSERT,UPDATE') and not has_table_privilege('service_role','public.publication_oauth_states','DELETE'),'states: no delete (trigger: single use, immutable)');
 foreach f in array array['public.publication_oauth_state_create(text,uuid,uuid,text,text)','public.publication_oauth_state_consume(text,text,text)','public.publication_oauth_record(uuid,text,text,text,jsonb,text)',
  'publications_private.guard_credential_secret()','publications_private.guard_oauth_state()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 perform pg_temp.replay_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name in('client_connections','publication_accounts','publication_oauth_states','publication_events')
  and column_name ~* '(token|secret|ciphertext|verifier|code$)'),'no secret column in business tables');
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_credential_secrets','42501','anon cannot read the vault');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_oauth_state_consume(''meta'',repeat(''a'',64),''user_x'')','42501','authenticated cannot consume a state');
reset role;

-- Fixtures: one client with a project, another client with a project.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P11 fixture'),(other,'P11 other');
 insert into p11_ids values('client',cl),('other_client',other),('project',gen_random_uuid()),('other_project',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p11_ids where name='project'),cl,'P11 social','Réseaux sociaux'),((select id from p11_ids where name='other_project'),other,'P11 other','Réseaux sociaux');
end $$;

-- 2. Encrypted vault table: server writes, immutable rows, deletion allowed, strict shape.
set local role service_role;
do $$declare ref text:='vault:connection/'||gen_random_uuid()::text;begin
 insert into public.publication_credential_secrets(reference,provider,key_id,iv,ciphertext,auth_tag) values(ref,'meta','k1',decode(repeat('00',12),'hex'),decode(repeat('ab',40),'hex'),decode(repeat('cd',16),'hex'));
 perform pg_temp.replay_assert((select key_id='k1' and octet_length(iv)=12 from public.publication_credential_secrets where reference=ref),'ciphertext stored by the server');
 perform pg_temp.replay_failure(format('insert into public.publication_credential_secrets(reference,provider,key_id,iv,ciphertext,auth_tag) values(%L,''meta'',''k1'',decode(repeat(''00'',12),''hex''),decode(repeat(''ab'',40),''hex''),decode(repeat(''cd'',16),''hex''))','EAAB-raw-token'),'23514','reference format enforced');
 perform pg_temp.replay_failure(format('insert into public.publication_credential_secrets(reference,provider,key_id,iv,ciphertext,auth_tag) values(%L,''google_ads'',''k1'',decode(repeat(''00'',12),''hex''),decode(repeat(''ab'',40),''hex''),decode(repeat(''cd'',16),''hex''))','vault:connection/'||gen_random_uuid()::text),'23514','publication providers only');
 perform pg_temp.replay_failure(format('insert into public.publication_credential_secrets(reference,provider,key_id,iv,ciphertext,auth_tag) values(%L,''meta'',''k1'',decode(repeat(''00'',8),''hex''),decode(repeat(''ab'',40),''hex''),decode(repeat(''cd'',16),''hex''))','vault:connection/'||gen_random_uuid()::text),'23514','96-bit IV only');
 reset role;
 perform pg_temp.replay_failure(format('update public.publication_credential_secrets set key_id=''k2'' where reference=%L',ref),'55000','rows immutable (owner included)');
 set local role service_role;
 delete from public.publication_credential_secrets where reference=ref;
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_credential_secrets where reference=ref),'secret deleted on disconnect / rotation');
end $$;

-- 3. OAuth state: creation (hash only), single use, TTL, provider / admin binding, client scope.
do $$declare cl uuid:=(select id from p11_ids where name='client');p uuid:=(select id from p11_ids where name='project');r jsonb;e public.publication_events;begin
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''facebook'',%L,%L,%L,''user_admin'')',cl,p,pg_temp.p11_hash('s0')),'22023','unknown provider');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''meta'',%L,%L,''raw-state'',''user_admin'')',cl,p),'22023','raw state never accepted (hash only)');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''meta'',%L,%L,%L,''admin'')',cl,p,pg_temp.p11_hash('s0')),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''meta'',%L,%L,%L,''user_admin'')',gen_random_uuid(),null,pg_temp.p11_hash('s0')),'23514','unknown client');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''meta'',%L,%L,%L,''user_admin'')',cl,(select id from p11_ids where name='other_project'),pg_temp.p11_hash('s0')),'23514','project of another client');
 perform public.publication_oauth_state_create('meta',cl,p,pg_temp.p11_hash('state-1'),'user_admin');
 perform pg_temp.replay_assert((select expires_at between now()+interval '9 minutes' and now()+interval '10 minutes' and consumed_at is null and state_hash=pg_temp.p11_hash('state-1') from public.publication_oauth_states where state_hash=pg_temp.p11_hash('state-1')),'state stored as a hash, 10 minutes');
 select * into e from public.publication_events where action='publication.oauth_started' and client_id=cl;
 perform pg_temp.replay_assert(e.metadata=jsonb_build_object('client_id',cl,'provider','meta'),'start audited without state');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_create(''meta'',%L,%L,%L,''user_admin'')',cl,p,pg_temp.p11_hash('state-1')),'23505','state unique');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_consume(''meta'',%L,''user_admin'')',pg_temp.p11_hash('forged')),'23514','forged state refused');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_consume(''google_business_profile'',%L,''user_admin'')',pg_temp.p11_hash('state-1')),'23514','state of another provider refused');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_consume(''meta'',%L,''user_intruder'')',pg_temp.p11_hash('state-1')),'23514','state of another admin refused');
 r:=public.publication_oauth_state_consume('meta',pg_temp.p11_hash('state-1'),'user_admin');
 perform pg_temp.replay_assert(r=jsonb_build_object('status','valid','client_id',cl,'project_id',p),'valid state: client and project resolved on the server');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_consume(''meta'',%L,''user_admin'')',pg_temp.p11_hash('state-1')),'55000','replay refused');
 perform pg_temp.replay_assert((select consumed_at is not null from public.publication_oauth_states where state_hash=pg_temp.p11_hash('state-1')),'state consumed');
end $$;
reset role;
-- Expired state (written by the owner to simulate an old callback): consumed and refused, audited as failure.
insert into public.publication_oauth_states(state_hash,provider,client_id,project_id,actor_id,created_at,expires_at)
values(pg_temp.p11_hash('old-state'),'google_business_profile',(select id from p11_ids where name='client'),null,'user_admin',now()-interval '20 minutes',now()-interval '10 minutes');
select pg_temp.replay_failure(format('insert into public.publication_oauth_states(state_hash,provider,client_id,actor_id,expires_at) values(%L,''meta'',%L,''user_admin'',now()+interval ''1 hour'')',pg_temp.p11_hash('long'),(select id from p11_ids where name='client')),'23514','TTL bounded (15 minutes max)');
select pg_temp.replay_failure(format('update public.publication_oauth_states set consumed_at=null where state_hash=%L',pg_temp.p11_hash('state-1')),'55000','a consumed state can never be reused');
select pg_temp.replay_failure(format('delete from public.publication_oauth_states where state_hash=%L',pg_temp.p11_hash('state-1')),'55000','states kept for audit');
set local role service_role;
do $$declare r jsonb;begin
 r:=public.publication_oauth_state_consume('google_business_profile',pg_temp.p11_hash('old-state'),'user_admin');
 perform pg_temp.replay_assert(r->>'status'='expired','expired state refused');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.oauth_failed' and metadata->>'code'='state_expired'),'expiry audited');
 perform pg_temp.replay_failure(format('select public.publication_oauth_state_consume(''google_business_profile'',%L,''user_admin'')',pg_temp.p11_hash('old-state')),'55000','expired state cannot be retried');
end $$;

-- 4. Full connection after a callback (P9 RPCs + P11 audit), kill switches still closed.
do $$declare cl uuid:=(select id from p11_ids where name='client');p uuid:=(select id from p11_ids where name='project');conn uuid;ch uuid;acc uuid;begin
 conn:=(public.publication_connection_register(cl,'meta','vault:connection/'||gen_random_uuid()::text,'1234567890',now()+interval '60 days','{}','user_admin')->>'connection_id')::uuid;
 perform public.publication_accounts_sync(cl,conn,jsonb_build_array(jsonb_build_object('platform','facebook','external_account_id','101','display_name','Toitures','parent_external_id',null,'metadata','{}'::jsonb)),'user_admin');
 perform public.publication_oauth_record(cl,'meta','oauth_completed',null,'{"accounts":1,"facebook":1,"instagram":0}','user_admin');
 perform pg_temp.replay_assert((select metadata=jsonb_build_object('client_id',cl,'provider','meta','connection_id',conn,'counts',jsonb_build_object('accounts',1,'facebook',1,'instagram',0))
  from public.publication_events where action='publication.oauth_completed' and client_id=cl),'completion audited: ids and counts only');
 perform pg_temp.replay_failure(format('select public.publication_oauth_record(%L,''meta'',''oauth_completed'',''Bearer EAAB'',null,''user_admin'')',cl),'22023','raw provider text refused as code');
 perform pg_temp.replay_failure(format('select public.publication_oauth_record(%L,''meta'',''oauth_completed'',null,''{"access_token":1}'',''user_admin'')',cl),'22023','unexpected counts key refused');
 perform pg_temp.replay_failure(format('select public.publication_oauth_record(%L,''meta'',''published'',null,null,''user_admin'')',cl),'22023','unknown outcome refused');
 perform public.publication_oauth_record(cl,'google_business_profile','connection_refreshed',null,null,'user_admin');
 perform public.publication_channel_save(p,'facebook',true,null,null,'user_local');
 select id into acc from public.publication_accounts where connection_id=conn;
 ch:=public.publication_channel_assign_account(p,'facebook',acc,'user_admin');
 perform pg_temp.replay_assert(publications_private.channel_publishability(ch)='emergency_stop','connected and assigned, yet nothing can be published (kill switch closed)');
 perform pg_temp.replay_assert(public.publication_job_claim('worker-p11',60) is null,'no job can be claimed under the emergency stop');
end $$;
reset role;

-- 5. Safety: nothing published, no secret in business tables or audit, settings unchanged.
select pg_temp.replay_assert((select (v->>'publications')::bigint=(select count(*) from public.publications) and (v->>'deliveries')::bigint=(select count(*) from public.publication_deliveries) from p11_before),'no publication, no delivery');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'kill switches unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action like 'publication.oauth%' or action like 'publication.connection%'
 having bool_or((coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(vault:|token|secret|bearer|state_hash|code_verifier|[a-f0-9]{64})')),'OAuth audit without token, reference, state or hash');
select pg_temp.replay_assert(not exists(select 1 from public.client_connections where metadata::text ~* '(token|secret)') and not exists(select 1 from public.publication_accounts where metadata::text ~* '(token|secret)'),'no token in business metadata');
