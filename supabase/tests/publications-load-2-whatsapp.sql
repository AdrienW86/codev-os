-- Synthetic PostgreSQL local test only (phase 8, #47). Never execute remotely.
-- Doublons WhatsApp sous charge, côté base : rejeux de webhook (même message 50 fois), même photo reçue dans plusieurs
-- messages, plusieurs centaines de photos d'archive analysées deux fois, un seul import d'export actif par client.
reset role;
do $$declare cl uuid:=gen_random_uuid();imp uuid:=gen_random_uuid();second uuid:=gen_random_uuid();i integer;got integer;claimed integer:=0;begin
 insert into public.clients(id,name,activity) values(cl,'Protection Nuisibles (fictif)','Dératisation');
 insert into public.whatsapp_senders(sender,client_id,drive_folder_id,rights_confirmed,enabled,updated_by) values('33612345678',cl,'folder_load_client_01',true,true,'user_local');
 -- 1. Webhook rejoué 50 fois (Meta réessaie tant qu'il n'a pas reçu 200) : une seule ligne de file.
 for i in 1..50 loop
  insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at)
  values('waba-1','phone-1','wamid.same','33612345678','media-1','image/jpeg',now()) on conflict(waba_id,message_id) do nothing;
 end loop;
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_inbox where message_id='wamid.same')=1,'50 webhook retries: one queued media');
 -- 300 messages distincts, dont la même photo envoyée 3 fois (messages différents) : 300 lignes de file.
 for i in 1..300 loop
  insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at)
  values('waba-1','phone-1','wamid.'||i,'33612345678','media-'||i,'image/jpeg',now()) on conflict(waba_id,message_id) do nothing;
 end loop;
 -- Réservation : une ligne à la fois, jamais deux fois la même tant que le bail court.
 set local role service_role;
 for i in 1..400 loop
  select count(*) into got from public.whatsapp_claim(gen_random_uuid());
  exit when got=0;claimed:=claimed+1;
 end loop;
 reset role;
 perform pg_temp.replay_assert(claimed=301,'301 media claimed once each, then idle');
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_inbox where status='processing' and attempts=1)=301,'each claimed exactly once (attempts = 1)');
 -- 2. Même photo (même empreinte) reçue dans plusieurs messages : une seule ligne de photothèque (upsert idempotent).
 for i in 1..3 loop
  insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size)
  values(cl,'folder_load_client_01',repeat('a',64),repeat('b',32),'drive-proposed-'||i,'image/jpeg',1000) on conflict(client_id,drive_folder_id,sha256) do nothing;
 end loop;
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_assets where client_id=cl and sha256=repeat('a',64))=1,'same photo three times: one library row');
 perform pg_temp.replay_assert((select drive_file_id from public.whatsapp_assets where client_id=cl and sha256=repeat('a',64))='drive-proposed-1','the first reserved Drive id is kept (idempotent upload)');
 -- 3. Archive de 800 photos analysée deux fois (rechargement, double clic) : 800 lignes, jamais 1600.
 insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,status,storage_path,rights_confirmed,created_by) values(imp,cl,'folder_load_client_01','uploading',cl||'/'||imp||'.zip',true,'user_local');
 for i in 1..2 loop
  insert into public.whatsapp_export_items(import_id,client_id,entry_name,entry_offset,compressed_size,size,method,crc32)
  select imp,cl,'IMG-2024-WA'||lpad(k::text,4,'0')||'.jpg',k*1000,900,900,8,k from generate_series(1,800) k on conflict(import_id,entry_name) do nothing;
 end loop;
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_export_items where import_id=imp)=800,'double analysis: 800 rows');
 -- Un seul import actif par client.
 perform pg_temp.replay_failure(format('insert into public.whatsapp_export_imports(id,client_id,drive_folder_id,status,storage_path,rights_confirmed,created_by) values(%L,%L,''folder_load_client_01'',''uploading'',%L,true,''user_local'')',second,cl,cl||'/'||second||'.zip'),'23505','second active export refused');
end $$;
