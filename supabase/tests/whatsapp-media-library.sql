begin;
insert into public.clients(id,name) values ('00000000-0000-4000-8000-000000000001','Pilote A'),('00000000-0000-4000-8000-000000000002','Client B');
insert into public.whatsapp_senders(sender,client_id,drive_folder_id,rights_confirmed,enabled,updated_by) values
 ('33612345678','00000000-0000-4000-8000-000000000001','folder_client_a',true,true,'sql-test'),
 ('33612345679','00000000-0000-4000-8000-000000000002','folder_client_b',true,true,'sql-test');
insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at,caption) values
 ('1','2','video_a','33612345678','3','video/mp4',now(),'Toiture terminée'),
 ('1','2','unknown_1','33600000001','4','image/jpeg',now(),null),
 ('1','2','unknown_2','33600000002','5','image/jpeg',now(),null);
do $$ declare r public.whatsapp_inbox; n integer; begin
  -- Numéro inconnu : jamais réservé automatiquement, une notification d'affectation.
  select * into r from public.whatsapp_claim('00000000-0000-4000-8000-000000000010');
  if r.message_id<>'video_a' or r.mime_type<>'video/mp4' then raise exception 'Video not claimed'; end if;
  if exists(select 1 from public.whatsapp_claim('00000000-0000-4000-8000-000000000011')) then raise exception 'Unknown sender claimed'; end if;
  if (select count(*) from public.admin_notifications where href='/settings/whatsapp')<>1 then raise exception 'Unassigned notification missing or duplicated'; end if;
  -- Import confirmé : une notification par client et par heure.
  update public.whatsapp_inbox set status='imported',lease=null,lease_until=null where id=r.id;
  if (select count(*) from public.admin_notifications where href='/clients/00000000-0000-4000-8000-000000000001?tab=media')<>1 then raise exception 'Import notification missing'; end if;
  -- Affectation : refusée vers un dossier d'un autre client ou par un acteur invalide.
  select id into r.id from public.whatsapp_inbox where message_id='unknown_1';
  begin perform public.whatsapp_assign(r.id,'00000000-0000-4000-8000-000000000001','folder_client_b','user_admin'); raise exception 'Cross folder assignment';
  exception when check_violation then null; end;
  begin perform public.whatsapp_assign(r.id,'00000000-0000-4000-8000-000000000001','folder_client_a','anonymous'); raise exception 'Invalid actor accepted';
  exception when invalid_parameter_value then null; end;
  perform public.whatsapp_assign(r.id,'00000000-0000-4000-8000-000000000001','folder_client_a','user_admin');
  begin perform public.whatsapp_assign(r.id,'00000000-0000-4000-8000-000000000002','folder_client_b','user_admin'); raise exception 'Reassignment allowed';
  exception when object_not_in_prerequisite_state then null; end;
  select * into r from public.whatsapp_claim('00000000-0000-4000-8000-000000000012');
  if r.message_id<>'unknown_1' or r.client_id<>'00000000-0000-4000-8000-000000000001' then raise exception 'Assigned media not claimed in its scope'; end if;
  -- Effacement d'un numéro : file rejetée, expéditeur et message effacés.
  n := public.whatsapp_forget_sender('33600000002','user_admin');
  if n<>1 or (select status from public.whatsapp_inbox where message_id='unknown_2')<>'dismissed' or exists(select 1 from public.whatsapp_inbox where sender='33600000002') then raise exception 'Forget incomplete'; end if;
  begin perform public.whatsapp_purge_personal_data(now()); raise exception 'Short retention accepted';
  exception when invalid_parameter_value then null; end;
end $$;
insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind) values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','folder_client_a',repeat('a',64),repeat('b',32),'file_video_a','video/mp4',16000000,'video');
insert into public.publications(id,client_id) values ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-000000000002');
do $$ begin
  -- Un média d'un client ne peut pas être rattaché à la publication d'un autre client.
  begin
    insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,used_by) values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000b1','facebook','user_admin');
    raise exception 'Cross client use';
  exception when foreign_key_violation then null; end;
  begin
    update public.whatsapp_assets set library_status='published' where id='00000000-0000-4000-8000-0000000000a1';
    raise exception 'Unknown library status';
  exception when check_violation then null; end;
  if has_table_privilege('anon','public.whatsapp_asset_uses','select') or has_function_privilege('authenticated','public.whatsapp_assign(uuid,uuid,text,text)','execute') then raise exception 'Public access'; end if;
  if not (select relrowsecurity from pg_class where oid='public.whatsapp_asset_uses'::regclass) then raise exception 'Missing RLS'; end if;
end $$;
rollback;
select 'WHATSAPP_LIBRARY_CHECKS=14';
