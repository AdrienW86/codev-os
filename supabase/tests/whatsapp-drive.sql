begin;
insert into public.clients(id,name) values ('00000000-0000-4000-8000-000000000001','WhatsApp A'),('00000000-0000-4000-8000-000000000002','WhatsApp B');
insert into public.whatsapp_senders(sender,client_id,drive_folder_id,rights_confirmed,enabled,updated_by) values
 ('33612345678','00000000-0000-4000-8000-000000000001','folder_client_a',true,true,'sql-test'),
 ('33612345679','00000000-0000-4000-8000-000000000002','folder_client_b',false,true,'sql-test');
insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at) values
 ('1','2','message_a','33612345678','3','image/jpeg',now()),
 ('1','2','message_b','33612345679','4','image/jpeg',now()),
 ('1','2','message_unknown','33612345670','5','image/jpeg',now());
-- Replay : conserve la réception originale.
insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at) values
 ('1','2','message_a','33612345678','3','image/jpeg',now()) on conflict(waba_id,message_id) do nothing;
do $$ declare r public.whatsapp_inbox; begin
  if (select count(*) from public.whatsapp_inbox)<>3 then raise exception 'Replay duplicated'; end if;
  select * into r from public.whatsapp_claim('00000000-0000-4000-8000-000000000010');
  if r.message_id<>'message_a' or r.client_id<>'00000000-0000-4000-8000-000000000001' then raise exception 'Wrong scope'; end if;
  if r.attempts<>1 or r.status<>'processing' then raise exception 'Wrong lease'; end if;
  if exists(select 1 from public.whatsapp_claim('00000000-0000-4000-8000-000000000011')) then raise exception 'Rights or unknown bypassed / lease reused'; end if;
  begin
    update public.whatsapp_inbox set client_id='00000000-0000-4000-8000-000000000002' where id=r.id;
    raise exception 'Scope mutable';
  exception when raise_exception then if sqlerrm='Scope mutable' then raise; end if; end;
  begin
    insert into public.whatsapp_senders(sender,client_id,drive_folder_id,updated_by) values ('33612345671','00000000-0000-4000-8000-000000000002','folder_client_a','sql-test');
    raise exception 'Folder isolation missing';
  exception when raise_exception then if sqlerrm='Folder isolation missing' then raise; end if; end;
end $$;
update public.whatsapp_inbox set lease_until=now()-interval '1 minute' where message_id='message_a';
do $$ declare r public.whatsapp_inbox; begin
  select * into r from public.whatsapp_claim('00000000-0000-4000-8000-000000000012');
  if r.message_id<>'message_a' or r.attempts<>2 then raise exception 'Expired lease not recovered'; end if;
  update public.whatsapp_inbox set attempts=5,lease_until=now()-interval '1 minute' where id=r.id;
  perform public.whatsapp_claim('00000000-0000-4000-8000-000000000013');
  if (select status from public.whatsapp_inbox where id=r.id)<>'failed' then raise exception 'Retries unbounded'; end if;
end $$;
insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size) values
 ('00000000-0000-4000-8000-000000000001','folder_client_a',repeat('a',64),repeat('b',32),'file_a','image/jpeg',1),
 ('00000000-0000-4000-8000-000000000002','folder_client_b',repeat('a',64),repeat('b',32),'file_b','image/jpeg',1);
do $$ begin
  begin
    insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size) values
    ('00000000-0000-4000-8000-000000000001','folder_client_a',repeat('a',64),repeat('b',32),'file_c','image/jpeg',1);
    raise exception 'Exact duplicate allowed';
  exception when unique_violation then null; end;
  begin
    insert into public.publication_agent_projects(client_id,drive_folder_id) values ('00000000-0000-4000-8000-000000000002','folder_client_a');
    raise exception 'Publication folder cross client';
  exception when raise_exception then if sqlerrm='Publication folder cross client' then raise; end if; end;
  insert into public.publication_agent_projects(client_id,drive_folder_id) values ('00000000-0000-4000-8000-000000000001','folder_existing');
  begin
    insert into public.whatsapp_senders(sender,client_id,drive_folder_id,updated_by) values ('33612345672','00000000-0000-4000-8000-000000000002','folder_existing','sql-test');
    raise exception 'Existing publication folder cross client';
  exception when raise_exception then if sqlerrm='Existing publication folder cross client' then raise; end if; end;
  if (select count(*) from public.whatsapp_assets)<>2 then raise exception 'Cross client hash collision'; end if;
  if has_table_privilege('anon','public.whatsapp_inbox','select') or has_table_privilege('authenticated','public.whatsapp_senders','select') then raise exception 'Public inbox access'; end if;
  if has_function_privilege('anon','public.whatsapp_claim(uuid)','execute') then raise exception 'Public worker'; end if;
  if exists(select 1 from pg_class where oid in ('public.whatsapp_senders'::regclass,'public.whatsapp_inbox'::regclass,'public.whatsapp_assets'::regclass) and not relrowsecurity) then raise exception 'Missing RLS'; end if;
end $$;
rollback;
select 'WHATSAPP_CHECKS=16';
