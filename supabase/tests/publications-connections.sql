-- Synthetic PostgreSQL local test only (Lot 4.3 P9). Never execute on a remote project.
-- Runs after publications-connections-before.sql (P8 state) and the P9 migration.
create function pg_temp.p9_ref() returns text language sql as $$ select 'vault:connection/'||gen_random_uuid()::text $$;
create function pg_temp.p9_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
create function pg_temp.p9_account(p_platform text,p_external text,p_name text,p_parent text default null) returns jsonb language sql as $$
 select jsonb_build_object('platform',p_platform,'external_account_id',p_external,'display_name',p_name,'parent_external_id',p_parent,'metadata','{}'::jsonb) $$;
grant execute on function pg_temp.p9_ref(),pg_temp.p9_error(text),pg_temp.p9_account(text,text,text,text) to service_role;

-- 1. Grants, function properties, RLS, browser denial.
do $$declare r text;f text;t text;begin
 foreach f in array array['public.publication_connection_register(uuid,text,text,text,timestamptz,jsonb,text)','public.publication_connection_set_status(uuid,text,text,timestamptz,text)',
  'public.publication_accounts_sync(uuid,uuid,jsonb,text)','public.publication_channel_assign_account(uuid,text,uuid,text)','public.publication_connection_disconnect(uuid,uuid,text)',
  'public.publication_connections_list(uuid)','public.publication_accounts_available(uuid)','publications_private.channel_publishability(uuid)',
  'publications_private.account_assignable(uuid,uuid,text)','publications_private.valid_credential_reference(text)','publications_private.connection_provider_platform(text,text)',
  'publications_private.guard_publication_connection()','publications_private.guard_publication_account()','publications_private.guard_channel_account()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 foreach t in array array['public.client_connections','public.publication_accounts','public.publication_project_channels'] loop
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS enabled '||t);
  perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename=split_part(t,'.',2)),'no browser policy '||t);
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser table privileges absent '||t||' '||r);end loop;
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_accounts','DELETE') and not has_table_privilege('service_role','public.publication_accounts','TRUNCATE'),'accounts never deleted by the server');
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.client_connections','42501','anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_connections_list(null)','42501','authenticated RPC denied');
select pg_temp.replay_failure('select * from public.publication_accounts','42501','authenticated read denied');
reset role;

-- 2. Additive migration, legacy compatibility (historical account and Google Ads connection untouched).
select pg_temp.replay_assert((select v->'connections' from p9_before)=(select coalesce(jsonb_agg(to_jsonb(c)-'credential_reference'-'connected_at'-'expires_at' order by c.id),'[]') from public.client_connections c),'connections unchanged');
select pg_temp.replay_assert((select v->'accounts' from p9_before)=(select coalesce(jsonb_agg(to_jsonb(a)-'connection_id'-'display_name'-'parent_external_id'-'last_synced_at' order by a.id),'[]') from public.publication_accounts a),'legacy accounts unchanged');
select pg_temp.replay_assert((select v->'channels' from p9_before)=(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),'channels and legacy account link unchanged');
select pg_temp.replay_assert((select (v->>'events')::bigint=(select count(*) from public.publication_events) from p9_before),'no event created by the migration');
select pg_temp.replay_assert((select enabled and status='connected' and credential_reference='ref:legacy/page-1' and connection_id is null from public.publication_accounts where id=(select id from p9_ids where name='legacy_account')),'legacy account still valid and enabled');
set local role service_role;
do $$declare ads uuid:=(select id from p9_ids where name='ads_connection');begin
 update public.client_connections set status='error',metadata='{"auth_strategy":"single_user","connection_version":1}' where id=ads;
 perform pg_temp.replay_assert((select status='error' from public.client_connections where id=ads),'Google Ads connection still managed by its service (direct writes, free status)');
 update public.client_connections set status='connected' where id=ads;
end $$;
reset role;
select pg_temp.replay_assert(publications_private.valid_credential_reference('vault:connection/'||gen_random_uuid()::text)
 and not publications_private.valid_credential_reference('vault:connection/abc') and not publications_private.valid_credential_reference('https://vault.example/x')
 and not publications_private.valid_credential_reference('{"access_token":"EAAB"}') and not publications_private.valid_credential_reference('EAABwzLixnjYBAKZBZC0token')
 and not publications_private.valid_credential_reference('ref:legacy/page-1') and not publications_private.valid_credential_reference(null),'credential reference: opaque format only');
select pg_temp.replay_assert(publications_private.connection_provider_platform('meta','facebook') and publications_private.connection_provider_platform('meta','instagram')
 and publications_private.connection_provider_platform('google_business_profile','google_business_profile') and not publications_private.connection_provider_platform('meta','google_business_profile')
 and not publications_private.connection_provider_platform('google_business_profile','instagram') and not publications_private.connection_provider_platform('google_ads','facebook'),'provider / platform matrix');

-- 3. Registration: strict input, opaque reference only, audit without reference.
set local role service_role;
do $$declare cl uuid:=(select id from p9_ids where name='client');r jsonb;ref1 text:=pg_temp.p9_ref();ref2 text:=pg_temp.p9_ref();meta uuid;e public.publication_events;begin
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''facebook'',%L,null,null,null,''user_local'')',cl,ref1),'22023','facebook is not a provider (meta)');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,null,null,null,''user_local'')',cl,'EAABwzLixnjYBAKZBZC0token'),'22023','raw token refused as reference');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,null,null,null,''user_local'')',cl,'https://vault.example/x'),'22023','URL refused as reference');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,null,null,%L,''user_local'')',cl,ref1,'{"access_token":"x"}'),'22023','token in metadata refused');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,%L,null,null,''user_local'')',cl,ref1,'https://graph'),'22023','URL as external identity refused');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,null,null,null,''admin'')',cl,ref1),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_connection_register(%L,''meta'',%L,null,null,null,''user_local'')',gen_random_uuid(),ref1),'23514','unknown client');
 r:=public.publication_connection_register(cl,'meta',ref1,'meta-user-1',now()+interval '60 days','{"account_name":"Toitures Dupont"}','user_local');meta:=(r->>'connection_id')::uuid;
 insert into p9_ids values('meta',meta);
 perform pg_temp.replay_assert(r->>'created'='true' and r->>'replaced_reference' is null,'meta connection created');
 perform pg_temp.replay_assert((select status='active' and credential_reference=ref1 and connected_at is not null and provider='meta' and client_id=cl from public.client_connections where id=meta),'active with its opaque reference');
 select * into e from public.publication_events where action='publication.connection_created' and resource_id=meta;
 perform pg_temp.replay_assert(e.metadata=jsonb_build_object('client_id',cl,'connection_id',meta,'provider','meta'),'creation audited without reference');
 r:=public.publication_connection_register(cl,'meta',ref2,'meta-user-1',null,null,'user_local');
 perform pg_temp.replay_assert(r->>'created'='false' and r->>'replaced_reference'=ref1 and (select credential_reference=ref2 from public.client_connections where id=meta),'re-registration: new reference, old one returned for the vault');
 r:=public.publication_connection_register(cl,'google_business_profile',pg_temp.p9_ref(),null,null,null,'user_local');insert into p9_ids values('gbp',(r->>'connection_id')::uuid);
 r:=public.publication_connection_register((select id from p9_ids where name='other_client'),'meta',pg_temp.p9_ref(),null,null,null,'user_local');insert into p9_ids values('other_meta',(r->>'connection_id')::uuid);
end $$;
-- Direct writes refused: publication connections and connection accounts change only through the RPCs.
do $$declare cl uuid:=(select id from p9_ids where name='client');meta uuid:=(select id from p9_ids where name='meta');begin
 perform pg_temp.replay_failure(format('insert into public.client_connections(client_id,provider,status,metadata) values(%L,''google_business_profile'',''pending'',''{}'')',(select id from p9_ids where name='other_client')),'55000','direct insert refused');
 perform pg_temp.replay_failure(format('update public.client_connections set status=''active'' where id=%L',meta),'55000','direct update refused');
 perform pg_temp.replay_failure(format('delete from public.client_connections where id=%L',meta),'55000','connection never deleted');
 perform pg_temp.replay_failure(format('insert into public.publication_accounts(client_id,platform,external_account_id,status,enabled,connection_id,display_name) values(%L,''facebook'',''x1'',''active'',true,%L,''X'')',cl,meta),'55000','direct account insert refused');
end $$;
reset role;
select pg_temp.replay_failure(format('update public.client_connections set metadata=''{"refresh_token":"x"}'' where id=%L',(select id from p9_ids where name='meta')),'55000','even the owner cannot write directly');
do $$begin
 perform set_config('codev.publication_connections','rpc',true);
 perform pg_temp.replay_failure(format('update public.client_connections set metadata=''{"refresh_token":"x"}'' where id=%L',(select id from p9_ids where name='meta')),'23514','token metadata refused by the table check');
 perform pg_temp.replay_failure(format('update public.client_connections set credential_reference=''EAABtoken'' where id=%L',(select id from p9_ids where name='meta')),'23514','raw token refused by the table check');
 perform pg_temp.replay_failure(format('update public.client_connections set status=''active'',credential_reference=null where id=%L',(select id from p9_ids where name='meta')),'23514','active requires a reference');
 perform set_config('codev.publication_connections','',true);
end $$;

-- 4. Sync: strict input, provider / platform, idempotent, unavailable, never deleted, never a credential.
set local role service_role;
do $$
declare cl uuid:=(select id from p9_ids where name='client');meta uuid:=(select id from p9_ids where name='meta');gbp uuid:=(select id from p9_ids where name='gbp');r jsonb;snap jsonb;n bigint;
 accounts jsonb:=jsonb_build_array(pg_temp.p9_account('facebook','page-1','Toitures Dupont'),pg_temp.p9_account('facebook','page-2','Toitures Dupont Lyon'),
  pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1'));
begin
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',(select id from p9_ids where name='other_client'),meta,accounts),'23514','connection of another client');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(pg_temp.p9_account('google_business_profile','loc-1','Fiche'))),'23514','GBP account on a Meta connection');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,gbp,jsonb_build_array(pg_temp.p9_account('facebook','page-9','Page'))),'23514','Facebook page on a GBP connection');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(pg_temp.p9_account('facebook','page-1','A'),pg_temp.p9_account('facebook','page-1','B'))),'22023','duplicate account');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(pg_temp.p9_account('facebook','page-1','A')||'{"access_token":"EAAB"}')),'22023','unexpected key (token) refused');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(jsonb_set(pg_temp.p9_account('facebook','page-1','A'),'{metadata}','{"page_token":"EAAB"}'))),'22023','token in account metadata refused');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(pg_temp.p9_account('facebook','https://facebook.com/p','A'))),'23514','URL as external id refused');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,%L,''user_local'')',cl,meta,jsonb_build_array(pg_temp.p9_account('facebook','legacy-page-1','Ancienne page'))),'23505','legacy account never taken over');
 r:=public.publication_accounts_sync(cl,meta,accounts,'user_local');
 perform pg_temp.replay_assert(r->>'inserted'='3' and r->>'updated'='0' and r->>'unavailable'='0','three accounts inserted');
 perform pg_temp.replay_assert((select count(*) from public.publication_accounts where connection_id=meta and status='active' and enabled and credential_reference is null and client_id=cl)=3,'active, enabled, no credential');
 perform pg_temp.replay_assert((select parent_external_id='page-1' and display_name='@toitures.dupont' from public.publication_accounts where connection_id=meta and platform='instagram'),'instagram account linked to its page');
 insert into p9_ids select 'fb1',id from public.publication_accounts where connection_id=meta and external_account_id='page-1';
 insert into p9_ids select 'fb2',id from public.publication_accounts where connection_id=meta and external_account_id='page-2';
 insert into p9_ids select 'ig1',id from public.publication_accounts where connection_id=meta and external_account_id='ig-1';
 select jsonb_agg(to_jsonb(a)-'last_synced_at'-'updated_at' order by a.id) into snap from public.publication_accounts a where connection_id=meta;select count(*) into n from public.publication_accounts;
 r:=public.publication_accounts_sync(cl,meta,accounts,'user_local');
 perform pg_temp.replay_assert(r->>'inserted'='0' and r->>'updated'='3' and r->>'unavailable'='0' and (select count(*) from public.publication_accounts)=n
  and snap=(select jsonb_agg(to_jsonb(a)-'last_synced_at'-'updated_at' order by a.id) from public.publication_accounts a where connection_id=meta),'sync idempotent');
 r:=public.publication_accounts_sync(cl,meta,accounts-2,'user_local');
 perform pg_temp.replay_assert(r->>'unavailable'='1' and (select status='unavailable' and not enabled from public.publication_accounts where id=(select id from p9_ids where name='ig1'))
  and (select count(*) from public.publication_accounts)=n,'absent account unavailable, never deleted');
 r:=public.publication_accounts_sync(cl,meta,accounts,'user_local');
 perform pg_temp.replay_assert((select status='active' and enabled from public.publication_accounts where id=(select id from p9_ids where name='ig1')),'account back when the provider exposes it again');
 r:=public.publication_accounts_sync(cl,gbp,jsonb_build_array(pg_temp.p9_account('google_business_profile','accounts/1/locations/7','Toitures Dupont — Lyon','accounts/1')),'user_local');
 insert into p9_ids select 'gbp1',id from public.publication_accounts where connection_id=gbp;
 r:=public.publication_accounts_sync((select id from p9_ids where name='other_client'),(select id from p9_ids where name='other_meta'),jsonb_build_array(pg_temp.p9_account('facebook','page-1','Autre client')),'user_local');
 insert into p9_ids select 'other_fb',id from public.publication_accounts where connection_id=(select id from p9_ids where name='other_meta');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.accounts_synced' and resource_id=meta)=4
  and (select metadata ?& array['client_id','connection_id','provider','inserted','updated','unavailable'] and not metadata ? 'accounts' from public.publication_events where action='publication.accounts_synced' and resource_id=meta order by created_at desc limit 1),'sync audited (aggregated)');
end $$;
reset role;
-- An admin-disabled account stays disabled across syncs.
do $$begin
 perform set_config('codev.publication_connections','rpc',true);
 update public.publication_accounts set status='disabled',enabled=false where id=(select id from p9_ids where name='fb2');
 perform set_config('codev.publication_connections','',true);
end $$;
set local role service_role;
select public.publication_accounts_sync((select id from p9_ids where name='client'),(select id from p9_ids where name='meta'),
 jsonb_build_array(pg_temp.p9_account('facebook','page-1','Toitures Dupont'),pg_temp.p9_account('facebook','page-2','Toitures Dupont Lyon'),pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1')),'user_local');
select pg_temp.replay_assert((select status='disabled' and not enabled from public.publication_accounts where id=(select id from p9_ids where name='fb2')),'disabled account not re-enabled by a sync');

-- 5. Channel ↔ account assignment: scope, platform, active account and connection.
do $$declare s uuid:=(select id from p9_ids where name='social');cl uuid:=(select id from p9_ids where name='client');ch uuid;e public.publication_events;begin
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p9_ids where name='ig1')),'23514','Instagram account on the Facebook channel');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p9_ids where name='other_fb')),'23514','account of another client');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p9_ids where name='fb2')),'23514','disabled account');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p9_ids where name='legacy_account')),'23514','legacy account (no connection) not assignable');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''instagram'',%L,''user_local'')',gen_random_uuid(),(select id from p9_ids where name='ig1')),'23514','channel not configured');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''google_business_profile'',%L,''user_local'')',s,(select id from p9_ids where name='fb1')),'23514','Facebook page on the GBP channel');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''google_business_profile'',true,%L,null,''user_local'')',s,(select id from p9_ids where name='fb2')),'23514','P1 save path refused too (FK or guard)');
 ch:=public.publication_channel_assign_account(s,'facebook',(select id from p9_ids where name='fb1'),'user_local');
 perform pg_temp.replay_assert((select publication_account_id=(select id from p9_ids where name='fb1') from public.publication_project_channels where id=ch),'account assigned');
 select * into e from public.publication_events where action='publication.channel_account_assigned' and resource_id=ch;
 perform pg_temp.replay_assert(e.metadata=jsonb_build_object('client_id',cl,'project_id',s,'platform','facebook','account_id',(select id from p9_ids where name='fb1'),'previous_account_id',(select id from p9_ids where name='legacy_account')),'assignment audited');
 perform pg_temp.replay_assert(public.publication_channel_assign_account(s,'facebook',(select id from p9_ids where name='fb1'),'user_local')=ch
  and (select count(*) from public.publication_events where action='publication.channel_account_assigned' and resource_id=ch)=1,'same assignment: no-op');
 perform public.publication_channel_assign_account(s,'google_business_profile',(select id from p9_ids where name='gbp1'),'user_local');
 perform pg_temp.replay_failure(format('update public.publication_project_channels set publication_account_id=%L where id=%L',(select id from p9_ids where name='fb2'),ch),'23514','direct update cannot bypass the guard');
 -- Saving the channel again (same account) is never re-checked.
 perform public.publication_channel_save(s,'facebook',false,(select id from p9_ids where name='fb1'),'Règles','user_local');
 perform public.publication_channel_save(s,'facebook',true,(select id from p9_ids where name='fb1'),null,'user_local');
end $$;

-- 6. Publishability (fail closed, most global reason first).
do $$declare s uuid:=(select id from p9_ids where name='social');cl uuid:=(select id from p9_ids where name='client');fb uuid;gb uuid;begin
 select id into fb from public.publication_project_channels where project_id=s and platform='facebook';select id into gb from public.publication_project_channels where project_id=s and platform='google_business_profile';
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='emergency_stop','global emergency stop first (current kill switch)');
 reset role;
 update public.publication_settings set emergency_stop=false;
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishing_disabled','publishing disabled globally');
 update public.publication_settings set publishing_enabled=true;
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishing_disabled','publishing disabled for the client (no client settings)');
 insert into public.publication_client_settings(client_id,publishing_enabled) values(cl,true) on conflict(client_id) do update set publishing_enabled=true;
 set local role service_role;
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishable' and publications_private.channel_publishability(gb)='publishable','publishable');
 perform public.publication_channel_save(s,'facebook',false,(select id from p9_ids where name='fb1'),null,'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='channel_disabled','channel disabled');
 perform public.publication_channel_save(s,'facebook',true,null,null,'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='no_account','no account');
 perform public.publication_channel_assign_account(s,'facebook',(select id from p9_ids where name='fb1'),'user_local');
 perform public.publication_accounts_sync(cl,(select id from p9_ids where name='meta'),jsonb_build_array(pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1')),'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='account_inactive','account no longer exposed: account inactive');
 perform public.publication_accounts_sync(cl,(select id from p9_ids where name='meta'),jsonb_build_array(pg_temp.p9_account('facebook','page-1','Toitures Dupont'),pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1')),'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishable','account back');
 perform public.publication_connection_set_status((select id from p9_ids where name='meta'),'expired',null,null,'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='connection_inactive' and publications_private.channel_publishability(gb)='publishable','expired Meta connection: Facebook only');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,''[]'',''user_local'')',cl,(select id from p9_ids where name='meta')),'55000','no sync on an inactive connection');
 perform public.publication_connection_set_status((select id from p9_ids where name='meta'),'active',null,now()-interval '1 minute','user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='connection_inactive','active but past expiry: inactive (fail closed)');
 perform public.publication_connection_set_status((select id from p9_ids where name='meta'),'active',pg_temp.p9_ref(),now()+interval '60 days','user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishable','refreshed connection');
end $$;

-- 7. Revocation, disconnect (explicit, history kept), reconnection.
do $$declare s uuid:=(select id from p9_ids where name='social');cl uuid:=(select id from p9_ids where name='client');meta uuid:=(select id from p9_ids where name='meta');
 fb uuid;r jsonb;ref text;n_accounts bigint;n_connections bigint;begin
 select id into fb from public.publication_project_channels where project_id=s and platform='facebook';
 r:=public.publication_connection_set_status(meta,'revoked',null,null,'user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_accounts where connection_id=meta and status='revoked' and not enabled)=2 and (select status='disabled' from public.publication_accounts where id=(select id from p9_ids where name='fb2')),'revoked: accounts revoked, admin-disabled one kept');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='connection_inactive','revoked connection not publishable');
 perform public.publication_connection_register(cl,'meta',pg_temp.p9_ref(),'meta-user-1',null,null,'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='account_inactive','reconnected: accounts stay revoked until a sync');
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(pg_temp.p9_account('facebook','page-1','Toitures Dupont'),pg_temp.p9_account('facebook','page-2','Toitures Dupont Lyon'),pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1')),'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability(fb)='publishable','publishable after the sync');
 select credential_reference into ref from public.client_connections where id=meta;select count(*) into n_accounts from public.publication_accounts;select count(*) into n_connections from public.client_connections;
 perform pg_temp.replay_failure(format('select public.publication_connection_disconnect(%L,%L,''user_local'')',(select id from p9_ids where name='other_client'),meta),'23514','disconnect outside the client');
 perform pg_temp.replay_failure(format('select public.publication_connection_disconnect(%L,%L,''user_local'')',cl,(select id from p9_ids where name='ads_connection')),'23514','Google Ads connection out of scope');
 r:=public.publication_connection_disconnect(cl,meta,'user_local');
 perform pg_temp.replay_assert(r->>'status'='disabled' and r->>'already'='false' and r->>'previous_reference'=ref,'disconnected; previous reference handed to the vault once');
 perform pg_temp.replay_assert((select status='disabled' and credential_reference is null and expires_at is null from public.client_connections where id=meta)
  and (select count(*) from public.publication_accounts where connection_id=meta and status='unavailable' and not enabled)=2
  and (select status='disabled' from public.publication_accounts where id=(select id from p9_ids where name='fb2')),'reference cleared, accounts unavailable (disabled one kept)');
 perform pg_temp.replay_assert((select publication_account_id=(select id from p9_ids where name='fb1') from public.publication_project_channels where id=fb)
  and publications_private.channel_publishability(fb)='connection_inactive','channel link kept (history), no longer publishable');
 perform pg_temp.replay_assert((select count(*) from public.publication_accounts)=n_accounts and (select count(*) from public.client_connections)=n_connections,'nothing deleted');
 perform pg_temp.replay_assert((select metadata ?& array['client_id','connection_id','provider','accounts_unavailable','channels_affected'] and metadata->>'channels_affected'='1'
  from public.publication_events where action='publication.connection_disconnected' and resource_id=meta),'disconnect audited');
 r:=public.publication_connection_disconnect(cl,meta,'user_local');
 perform pg_temp.replay_assert(r->>'already'='true' and r->>'previous_reference' is null and (select count(*) from public.publication_events where action='publication.connection_disconnected' and resource_id=meta)=1,'disconnect idempotent');
 perform pg_temp.replay_failure(format('select public.publication_connection_set_status(%L,''active'',null,null,''user_local'')',meta),'55000','a disconnected connection is not revived by a status');
 perform pg_temp.replay_failure(format('select public.publication_accounts_sync(%L,%L,''[]'',''user_local'')',cl,meta),'55000','no sync after disconnect');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p9_ids where name='fb2')),'23514','no assignment from a disconnected connection');
 perform public.publication_channel_assign_account(s,'facebook',null,'user_local');
 perform pg_temp.replay_assert((select publication_account_id is null from public.publication_project_channels where id=fb) and publications_private.channel_publishability(fb)='no_account','account cleared explicitly');
 r:=public.publication_connection_register(cl,'meta',pg_temp.p9_ref(),'meta-user-1',null,null,'user_local');
 perform pg_temp.replay_assert(r->>'created'='false' and r->>'replaced_reference' is null and (select status='active' from public.client_connections where id=meta),'reconnection reuses the connection');
end $$;

-- 8. Listings: counts and statuses only; never a credential reference or an external identifier.
do $$declare cl uuid:=(select id from p9_ids where name='client');l jsonb;a jsonb;begin
 perform public.publication_accounts_sync(cl,(select id from p9_ids where name='meta'),jsonb_build_array(pg_temp.p9_account('facebook','page-1','Toitures Dupont'),pg_temp.p9_account('instagram','ig-1','@toitures.dupont','page-1')),'user_local');
 l:=public.publication_connections_list(cl);a:=public.publication_accounts_available(cl);
 perform pg_temp.replay_assert(jsonb_array_length(l)=2 and (select bool_and(x->>'provider' in('meta','google_business_profile')) from jsonb_array_elements(l) x),'publication providers only (no Google Ads)');
 perform pg_temp.replay_assert((select x->'accounts'=jsonb_build_object('facebook',1,'instagram',1,'google_business_profile',0) and x->>'has_credential'='true' from jsonb_array_elements(l) x where x->>'provider'='meta'),'meta counts');
 perform pg_temp.replay_assert((select x->'accounts'->>'google_business_profile'='1' from jsonb_array_elements(l) x where x->>'provider'='google_business_profile'),'gbp counts');
 perform pg_temp.replay_assert(l::text !~ '(vault:|credential_reference|meta-user|token)' and a::text !~ '(vault:|credential_reference|external_account_id|page-1|ig-1|accounts/1)','listings without reference or external id');
 perform pg_temp.replay_assert((select count(*) from jsonb_array_elements(a) x where x->>'assignable'='true')=3 and (select bool_and(x ?& array['id','platform','display_name','status','assignable']) from jsonb_array_elements(a) x),'available accounts');
 perform pg_temp.replay_assert(public.publication_connections_list((select id from p9_ids where name='other_client'))::text !~ 'Toitures','client scope strict');
end $$;
reset role;

-- 9. Audit and safety.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action in('publication.connection_created','publication.connection_status_changed',
 'publication.accounts_synced','publication.channel_account_assigned','publication.connection_disconnected')
 and (coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(vault:|token|secret|credential|https?:|page-|ig-|accounts/)'),'audit without reference, token or provider data');
select pg_temp.replay_assert(not exists(select 1 from public.client_connections where metadata::text ~* '(token|secret)') and not exists(select 1 from public.publication_accounts where metadata::text ~* '(token|secret)'),'no token in metadata');
select pg_temp.replay_assert(not exists(select 1 from public.publication_accounts where connection_id is not null and credential_reference is not null),'connection accounts never carry a credential');
select pg_temp.replay_assert((select (v->>'publications')::bigint=(select count(*) from public.publications) and (v->>'deliveries')::bigint=(select count(*) from public.publication_deliveries)
 and (v->>'jobs')::bigint=(select count(*) from public.publication_jobs) from p9_before),'no publication, delivery or job created');
select pg_temp.replay_failure(format('delete from public.publication_accounts where id=%L',(select id from p9_ids where name='fb1')),'55000','account never deleted (owner included)');
select pg_temp.replay_failure('truncate public.publication_accounts cascade','55000','accounts never truncated');
