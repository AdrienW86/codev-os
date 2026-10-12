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
