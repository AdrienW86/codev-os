-- =========================================================================================================
-- PR #41 : application manuelle de supabase/migrations/20261101000000_whatsapp_export_import.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261101000000_whatsapp_export_import.sql (md5 2070fedbbc2cfd339544e330a0540411, 5531 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['media_library_intelligence','publications_supervision']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='whatsapp_export_import' or name ~ '^[0-9]{14}_whatsapp_export_import$')) then
  raise exception 'ARRET : la migration 20261101000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regclass('public.whatsapp_export_imports') is not null
  or to_regclass('public.whatsapp_export_items') is not null
  or to_regclass('public.whatsapp_export_imports_client') is not null
  or to_regclass('public.whatsapp_export_imports_one_active') is not null
  or to_regclass('public.whatsapp_export_imports_purge') is not null
  or to_regclass('public.whatsapp_export_items_work') is not null
  or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_imports') and tgname='whatsapp_export_imports_updated')
  or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_items') and tgname='whatsapp_export_items_updated')
  or exists(select 1 from storage.buckets where id='whatsapp-exports') then
  raise exception 'ARRET : des objets de la migration 20261101000000 existent déjà, ne pas la rejouer'; end if;


end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_whatsapp_assets on commit drop as select * from public.whatsapp_assets;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Socle Publications, lot 3 : import d'un export de discussion WhatsApp depuis la fiche client.
-- Dépend de 20261028000000_media_library_intelligence.sql (origine « whatsapp_export » et date d'origine).
-- L'archive (et des aperçus réduits) est déposée dans un bucket privé temporaire, analysée par lots, puis supprimée. La conversation n'est
-- jamais stockée : seules les pièces jointes images retenues, leur date et leur légende sont conservées.
-- Forward-only. RLS active sans politique : uniquement le serveur (service_role).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-exports', 'whatsapp-exports', false, 524288000, array['application/zip','application/x-zip-compressed','application/octet-stream','image/webp']);

create table public.whatsapp_export_imports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  drive_folder_id text not null check (drive_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
  status text not null default 'uploading' check (status in ('uploading','analyzing','ready','importing','completed','cancelled','expired','failed')),
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.zip$'),
  archive_size bigint check (archive_size is null or archive_size between 1 and 524288000),
  -- Compteurs d'analyse et d'import (jamais de texte de conversation).
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  incomplete boolean not null default false,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  rights_confirmed boolean not null check (rights_confirmed),
  created_by text not null check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  purged_at timestamptz,
  unique (id, client_id),
  constraint whatsapp_export_imports_path_scope check (storage_path = client_id::text || '/' || id::text || '.zip')
);
create index whatsapp_export_imports_client on public.whatsapp_export_imports (client_id, created_at desc);
create index whatsapp_export_imports_purge on public.whatsapp_export_imports (expires_at) where purged_at is null;
-- Un seul import actif par client, même avec deux démarrages simultanés (le second reçoit une violation d'unicité).
create unique index whatsapp_export_imports_one_active on public.whatsapp_export_imports (client_id) where status in ('uploading','analyzing','ready','importing');

create table public.whatsapp_export_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  client_id uuid not null,
  entry_name text not null check (length(entry_name) between 1 and 300 and entry_name !~ '[\x00-\x1f]'),
  entry_offset bigint not null check (entry_offset >= 0),
  compressed_size bigint not null check (compressed_size >= 0),
  size bigint not null check (size >= 0),
  method smallint not null check (method in (0, 8)),
  crc32 bigint not null check (crc32 between 0 and 4294967295),
  captured_at timestamptz,
  -- Légende du message de la photo uniquement ; effacée quand l'import est terminé, annulé ou expiré.
  caption text check (caption is null or length(caption) <= 3000),
  -- « importing » : photo réservée par un lot d'import (compare-and-set), deux onglets ne la traitent jamais en même temps.
  status text not null default 'pending' check (status in ('pending','ready','importing','duplicate','invalid','too_large','imported','failed')),
  selected boolean not null default true,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  md5 text check (md5 is null or md5 ~ '^[0-9a-f]{32}$'),
  mime_type text check (mime_type is null or mime_type in ('image/jpeg','image/png','image/webp')),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  preview_path text check (preview_path is null or preview_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  asset_id uuid,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (import_id, client_id) references public.whatsapp_export_imports(id, client_id) on delete cascade,
  foreign key (asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete restrict,
  unique (import_id, entry_name)
);
create index whatsapp_export_items_work on public.whatsapp_export_items (import_id, status) where status in ('pending','ready','importing');

create trigger whatsapp_export_imports_updated before update on public.whatsapp_export_imports for each row execute function publications_private.touch_updated_at();
create trigger whatsapp_export_items_updated before update on public.whatsapp_export_items for each row execute function publications_private.touch_updated_at();

alter table public.whatsapp_export_imports enable row level security;
alter table public.whatsapp_export_items enable row level security;
revoke all on public.whatsapp_export_imports, public.whatsapp_export_items from public, anon, authenticated;
grant select, insert, update on public.whatsapp_export_imports, public.whatsapp_export_items to service_role;
grant delete on public.whatsapp_export_items to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_export_imports')),false)=true) then raise exception 'VERIFICATION : %', 'table public.whatsapp_export_imports : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'DELETE')=true,false)) then raise exception 'VERIFICATION : %', 'table public.whatsapp_export_imports : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE,DELETE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_export_items')),false)=true) then raise exception 'VERIFICATION : %', 'table public.whatsapp_export_items : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'DELETE')=true,false)) then raise exception 'VERIFICATION : %', 'table public.whatsapp_export_items : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE,DELETE'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_client') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_export_imports_client sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_one_active') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=true)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_export_imports_one_active sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_purge') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_export_imports_purge sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_items_work') and indrelid=to_regclass('public.whatsapp_export_items') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_export_items_work sur public.whatsapp_export_items : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.whatsapp_export_imports') and conname='whatsapp_export_imports_path_scope' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte whatsapp_export_imports_path_scope sur public.whatsapp_export_imports : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_imports') and tgname='whatsapp_export_imports_updated' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.touch_updated_at()'))) then raise exception 'VERIFICATION : %', 'déclencheur whatsapp_export_imports_updated sur public.whatsapp_export_imports : présent, actif, appelle publications_private.touch_updated_at()'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_items') and tgname='whatsapp_export_items_updated' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.touch_updated_at()'))) then raise exception 'VERIFICATION : %', 'déclencheur whatsapp_export_items_updated sur public.whatsapp_export_items : présent, actif, appelle publications_private.touch_updated_at()'; end if;
 if not (exists(select 1 from storage.buckets where id='whatsapp-exports' and public=false and coalesce(file_size_limit::text,'')='524288000' and coalesce(allowed_mime_types::text,'')='{application/zip,application/x-zip-compressed,application/octet-stream,image/webp}')) then raise exception 'VERIFICATION : %', 'bucket whatsapp-exports : privé, 524288000 octets maximum, types {application/zip,application/x-zip-compressed,application/octet-stream,image/webp}'; end if;
 if not (not exists(select 1 from pg_policies where schemaname='storage' and (coalesce(qual,'')||coalesce(with_check,'')) like '%whatsapp-exports%')) then raise exception 'VERIFICATION : %', 'stockage : aucune politique sur storage.objects ne mentionne le bucket whatsapp-exports (accès serveur uniquement)'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.whatsapp_assets','_kit_snap_public_whatsapp_assets',''),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
  select string_agg(format('%I', attname), ',' order by attnum) into cols from pg_attribute
   where attrelid=('pg_temp.'||t.snap)::regclass and attnum>0 and not attisdropped and attname<>all(string_to_array(t.excluded, ','));
  execute format('select count(*) from ((select row(%s)::text from pg_temp.%I) except all (select row(%s)::text from %s)) d', cols, t.snap, cols, t.rel) into n;
  if n<>0 then raise exception 'VERIFICATION : % ligne(s) de % modifiée(s)', n, t.rel; end if;
  execute format('select (select count(*) from %s)-(select count(*) from pg_temp.%I)', t.rel, t.snap) into n;
  if n<>0 then raise exception 'VERIFICATION : le nombre de lignes de % a changé', t.rel; end if;
 end loop;
 if (select auto_prepare from _kit_flags)<>(select count(*) from public.publication_client_settings where auto_prepare_enabled)
  or (select emergency_stop from _kit_flags)<>(select count(*) from public.publication_settings where emergency_stop) then
  raise exception 'VERIFICATION : un interrupteur de publication a changé'; end if;

 raise notice 'Migration 20261101000000 appliquée et vérifiée (% contrôles).', 13;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261101000000 appliquée' as migration, 13 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
