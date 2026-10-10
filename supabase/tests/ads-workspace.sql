begin;
create temporary table workspace_checks(passed integer not null);
insert into workspace_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Workspace check failed: %', label; end if;
  update pg_temp.workspace_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'Workspace check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id,name) values ('aaaaaaaa-0000-4000-8000-0000000000a1','Test Ads A'), ('aaaaaaaa-0000-4000-8000-0000000000b1','Test Ads B');
insert into public.client_connections(id,client_id,provider,status,external_account_id) values
  ('cccccccc-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-0000000000a1','google_ads','connected','1234567890'),
  ('cccccccc-0000-4000-8000-0000000000b1','aaaaaaaa-0000-4000-8000-0000000000b1','google_ads','connected','1234567890');

select pg_temp.ok(not has_table_privilege('anon','public.client_ads_scopes','select'), 'anon cannot read scope');
select pg_temp.ok(not has_table_privilege('authenticated','public.client_ads_campaigns','insert'), 'authenticated cannot assign campaigns');
select pg_temp.ok(not has_function_privilege('anon','public.codev_set_ads_campaigns(uuid,uuid,text,text[],integer)','execute'), 'anon cannot invoke RPC');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.client_ads_scopes'::regclass), 'scope RLS');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.client_ads_campaigns'::regclass), 'campaign RLS');
select pg_temp.ok(has_function_privilege('service_role','public.codev_set_ads_campaigns(uuid,uuid,text,text[],integer)','execute'), 'server can invoke RPC');

select pg_temp.ok(public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['123'],0) = 1, 'initial revision');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000b1','cccccccc-0000-4000-8000-0000000000b1','1234567890',array['123'],0)$$,'23505','contradictory assignment refused');
select pg_temp.ok(not exists(select 1 from public.client_ads_scopes where client_id='aaaaaaaa-0000-4000-8000-0000000000b1'),'failed transaction creates no scope');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['456'],0)$$,'40001','stale revision refused');
select pg_temp.ok((select campaign_id='123' from public.client_ads_campaigns where client_id='aaaaaaaa-0000-4000-8000-0000000000a1'),'stale save preserves selection');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000b1','1234567890',array['456'],1)$$,'55000','cross-client connection refused');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','0000000000',array['456'],1)$$,'55000','cross-account refused');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['123','123'],1)$$,'22023','duplicates refused');
select pg_temp.fails($$update public.client_connections set external_account_id='0000000000' where id='cccccccc-0000-4000-8000-0000000000a1'$$,'23503','association cannot silently change');
select pg_temp.ok(public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890','{}'::text[],1) = 2,'empty selection persists');
select pg_temp.ok(exists(select 1 from public.client_ads_scopes where client_id='aaaaaaaa-0000-4000-8000-0000000000a1') and not exists(select 1 from public.client_ads_campaigns where client_id='aaaaaaaa-0000-4000-8000-0000000000a1'),'empty is configured, not legacy default');

select 'ADS_WORKSPACE_CHECKS=' || passed from workspace_checks;
rollback;
