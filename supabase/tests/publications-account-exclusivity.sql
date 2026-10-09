-- Synthetic PostgreSQL local test only (Lot 4.3 P13). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (client "P10 fixture": Meta connection, Page page-10 assigned to
-- its Facebook channel; switches open) and every migration through P13.

-- 1. Grants and function properties.
do $$declare r text;f text;begin
 foreach f in array array['publications_private.account_used_by_other_client(uuid)','publications_private.account_assignable(uuid,uuid,text)','publications_private.channel_publishability(uuid)',
  'public.publication_channel_assign_account(uuid,text,uuid,text)','public.publication_accounts_available(uuid)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
 perform pg_temp.replay_assert((select prosrc like '%pg_advisory_xact_lock%' from pg_proc where oid='public.publication_channel_assign_account(uuid,text,uuid,text)'::regprocedure),'assignments of one external account serialized');
end $$;

-- 2. A second client whose connection (same administrator Meta login) also lists page-10.
do $$declare cl2 uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();meta2 uuid;begin
 insert into public.clients(id,name,activity) values(cl2,'P13 second client','Plomberie');
 insert into public.projects(id,client_id,name,type) values(p2,cl2,'P13 social','Réseaux sociaux');
 insert into public.publication_client_settings(client_id,publishing_enabled) values(cl2,true);
 insert into p10_ids values('client2',cl2),('social2',p2);
 set local role service_role;
 insert into p10_ids values('fb2_channel',public.publication_channel_save(p2,'facebook',true,null,null,'user_local'));
 meta2:=(public.publication_connection_register(cl2,'meta','vault:connection/'||gen_random_uuid()::text,'meta-user-10',null,null,'user_local')->>'connection_id')::uuid;
 insert into p10_ids values('meta2',meta2);
 perform public.publication_accounts_sync(cl2,meta2,jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-10','display_name','Toitures P10','parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','facebook','external_account_id','page-20','display_name','Plomberie P13','parent_external_id',null,'metadata','{}'::jsonb)),'user_local');
 reset role;
 insert into p10_ids select 'fb2_page10',id from public.publication_accounts where client_id=cl2 and external_account_id='page-10';
 insert into p10_ids select 'fb2_page20',id from public.publication_accounts where client_id=cl2 and external_account_id='page-20';
end $$;

-- 3. Listing is harmless; assigning a Page used by another client is refused (23505), its own Page is accepted.
set local role service_role;
do $$declare cl2 uuid:=(select id from p10_ids where name='client2');p2 uuid:=(select id from p10_ids where name='social2');a jsonb;begin
 a:=public.publication_accounts_available(cl2);
 perform pg_temp.replay_assert(jsonb_array_length(a)=2,'both Pages listed for the second client');
 perform pg_temp.replay_assert((select bool_and((x->>'used_by_other_client')::boolean=(x->>'display_name'='Toitures P10') and (x->>'assignable')::boolean=(x->>'display_name'<>'Toitures P10')) from jsonb_array_elements(a) x),
  'page-10 flagged as used by another client and not assignable; page-20 assignable');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',p2,(select id from p10_ids where name='fb2_page10')),'23505','Page of another client refused');
 perform pg_temp.replay_assert((select publication_account_id is null from public.publication_project_channels where id=(select id from p10_ids where name='fb2_channel')),'channel left unassigned');
 perform public.publication_channel_assign_account(p2,'facebook',(select id from p10_ids where name='fb2_page20'),'user_local');
 perform pg_temp.replay_assert((select publication_account_id=(select id from p10_ids where name='fb2_page20') from public.publication_project_channels where id=(select id from p10_ids where name='fb2_channel')),'own Page assigned');
 perform pg_temp.replay_assert(publications_private.channel_publishability((select id from p10_ids where name='fb2_channel'))='publishable','second client publishable on its own Page');
 perform pg_temp.replay_assert(publications_private.channel_publishability((select id from p10_ids where name='fb'))='publishable','first client still publishable on page-10');
 perform pg_temp.replay_assert((select count(*)=0 from public.publication_events where action='publication.channel_account_assigned' and metadata->>'account_id'=(select id from p10_ids where name='fb2_page10')::text),'refused assignment not audited as done');
end $$;
reset role;

-- 4. The direct write path is guarded too (trigger uses the same rule).
select pg_temp.replay_failure(format('update public.publication_project_channels set publication_account_id=%L where id=%L',(select id from p10_ids where name='fb2_page10'),(select id from p10_ids where name='fb2_channel')),'23514','direct write refused by the guard trigger');

-- 5. Release by the first client → the second client may take the Page; then the first one can no longer reassign it.
set local role service_role;
do $$declare s uuid:=(select id from p10_ids where name='social');p2 uuid:=(select id from p10_ids where name='social2');begin
 perform public.publication_channel_assign_account(s,'facebook',null,'user_local');
 perform public.publication_channel_assign_account(p2,'facebook',(select id from p10_ids where name='fb2_page10'),'user_local');
 perform pg_temp.replay_assert((select publication_account_id=(select id from p10_ids where name='fb2_page10') from public.publication_project_channels where id=(select id from p10_ids where name='fb2_channel')),'released Page taken by the second client');
 perform pg_temp.replay_failure(format('select public.publication_channel_assign_account(%L,''facebook'',%L,''user_local'')',s,(select id from p10_ids where name='fb_account')),'23505','first client can no longer take it back');
 perform public.publication_channel_assign_account(p2,'facebook',(select id from p10_ids where name='fb2_page20'),'user_local');
 perform public.publication_channel_assign_account(s,'facebook',(select id from p10_ids where name='fb_account'),'user_local');
 perform pg_temp.replay_assert(publications_private.channel_publishability((select id from p10_ids where name='fb'))='publishable','first client back on page-10');
end $$;
reset role;

-- 6. A pre-existing double assignment (created before P13, simulated by bypassing the guard) blocks every delivery
-- of that Page before any provider call: account_shared.
do $$declare pub uuid;d uuid;early uuid;c jsonb;begin
 -- A delivery prepared while the Page was still exclusive, due now.
 early:=pg_temp.p10_publication('facebook','Texte P13 préparé');set local role service_role;
 d:=(public.publication_prepare_delivery(early,'user_local')->>'delivery_id')::uuid;reset role;
 update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=d and type='deliver' and status='pending';
 alter table public.publication_project_channels disable trigger project_channel_account_guard;
 update public.publication_project_channels set publication_account_id=(select id from p10_ids where name='fb2_page10') where id=(select id from p10_ids where name='fb2_channel');
 alter table public.publication_project_channels enable trigger project_channel_account_guard;
 perform pg_temp.replay_assert(publications_private.channel_publishability((select id from p10_ids where name='fb'))='account_shared'
  and publications_private.channel_publishability((select id from p10_ids where name='fb2_channel'))='account_shared','both channels blocked: account_shared');
 set local role service_role;
 c:=public.publication_job_claim('w-p13',60);
 perform pg_temp.replay_assert(c is null and (select status='blocked' and blocked_reason='account_shared' from public.publication_deliveries where id=d),'prepared delivery blocked at claim time (account_shared)');
 reset role;
 pub:=pg_temp.p10_publication('facebook','Texte P13');set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''user_local'')',pub),'55000','no preparation on a shared Page');
 reset role;
end $$;
select pg_temp.replay_assert(not exists(select 1 from public.publication_jobs where dispatched_at is not null and delivery_id in(select id from public.publication_deliveries where publication_account_id in(
 (select id from p10_ids where name='fb_account'),(select id from p10_ids where name='fb2_page10')))),'nothing dispatched on the shared Page');
