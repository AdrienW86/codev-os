-- Synthetic PostgreSQL local test only (socle Publications, lot 3 : import d'exports WhatsApp). Never execute remotely.
-- Runs on the full migration chain; every statement is rolled back by the runner.
create function pg_temp.wx_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.wx_error(text) to service_role;
insert into public.clients(id,name) values('c7000000-0000-4000-8000-000000000001','Client export'),('c7000000-0000-4000-8000-000000000002','Autre client');

-- 1. Private bucket, browser roles denied, RLS on.
do $$declare t text;r text;begin
 perform pg_temp.replay_assert((select not public and file_size_limit=524288000 from storage.buckets where id='whatsapp-exports'),'private bounded bucket');
 foreach t in array array['public.whatsapp_export_imports','public.whatsapp_export_items'] loop
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT') and not has_table_privilege(r,t,'INSERT'),'browser denied '||t||' '||r);
  end loop;
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS on '||t);
 end loop;
end $$;

set local role service_role;
-- 2. Import rows: path bound to client and id, rights required, actor format, 24 h expiry.
do $$declare i public.whatsapp_export_imports;begin
 insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,storage_path,rights_confirmed,created_by)
 values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','folder_abcdef123','c7000000-0000-4000-8000-000000000001/e7000000-0000-4000-8000-000000000001.zip',true,'user_local')
 returning * into i;
 perform pg_temp.replay_assert(i.status='uploading' and i.expires_at between now()+interval '23 hours' and now()+interval '25 hours','uploading with 24 h expiry');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,storage_path,rights_confirmed,created_by)
  values('e7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000001','folder_abcdef123','c7000000-0000-4000-8000-000000000002/e7000000-0000-4000-8000-000000000002.zip',true,'user_local')$q$)='23514','path scoped to client');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,storage_path,rights_confirmed,created_by)
  values('e7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000001','folder_abcdef123','c7000000-0000-4000-8000-000000000001/e7000000-0000-4000-8000-000000000003.zip',false,'user_local')$q$)='23514','rights confirmation required');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,storage_path,rights_confirmed,created_by)
  values('e7000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000001','folder_abcdef123','c7000000-0000-4000-8000-000000000001/e7000000-0000-4000-8000-000000000004.zip',true,'system')$q$)='23514','human actor required');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$update public.whatsapp_export_imports set status='published' where id='e7000000-0000-4000-8000-000000000001'$q$)='23514','closed status set');
end $$;

-- 3. Items: bounded caption, same-client binding, unique entry per import, cascade on purge of items.
do $$begin
 insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32,caption)
 values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','IMG-20240112-WA0003.jpg',0,10,10,8,1,'Pose de stations');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32)
  values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','IMG-20240112-WA0003.jpg',0,10,10,8,1)$q$)='23505','one row per entry');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32)
  values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002','b.jpg',0,10,10,8,1)$q$)='23503','item bound to the import client');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32,caption)
  values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','c.jpg',0,10,10,8,1,repeat('x',3001))$q$)='23514','caption bounded');
 perform pg_temp.replay_assert(pg_temp.wx_error($q$insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32)
  values('e7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','d.jpg',0,10,10,12,1)$q$)='23514','stored or deflate only');
 update public.whatsapp_export_items set caption=null where import_id='e7000000-0000-4000-8000-000000000001';
 perform pg_temp.replay_assert((select count(*)=0 from public.whatsapp_export_items where caption is not null),'captions erasable at purge');
end $$;
