-- Données locales représentatives de la production pour scripts/migration-kit.mjs (jamais appliquées à distance).
insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,imported_at,library_status)
select 'c9000000-0000-4000-8000-000000000001','folder_seed_0001',repeat(i::text,64),repeat(i::text,32),'drive_seed_file_'||i,'image/jpeg',1000*i,now(),'validated'
from generate_series(1,2) i;
