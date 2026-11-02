-- Vidéos motion design : (a) une publication TikTok peut porter une vidéo MP4 à la place de photos ;
-- (b) Studio vidéo, activité distincte : bibliothèque des vidéos créées par client, stockage privé dédié.
-- Toute diffusion reste une publication validée par un humain (règle TikTok inchangée).
-- 1) Stockage privé dédié aux vidéos (aucune politique : accès service_role uniquement, comme les images).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('publication-videos','publication-videos',false,67108864,array['video/mp4'])
on conflict (id) do nothing;

-- 2) Un média de publication peut être une vidéo MP4.
alter table public.publication_assets drop constraint if exists publication_assets_mime_type_check;
alter table public.publication_assets add constraint publication_assets_mime_type_check
 check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4'));

-- 3) Invariant : une vidéo n'est rattachée qu'à une variante TikTok, et seule (TikTok publie soit des photos, soit une
--    vidéo). Facebook, Instagram et Google ne reçoivent donc jamais de vidéo par ce circuit.
create or replace function publications_private.guard_variant_video() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare is_video boolean; platform text;
begin
 select a.mime_type='video/mp4' into is_video from public.publication_assets a where a.id=new.asset_id and a.client_id=new.client_id;
 select v.platform into platform from public.publication_variants v where v.id=new.variant_id;
 if coalesce(is_video,false) then
  if platform is distinct from 'tiktok' then raise exception 'Video only on TikTok' using errcode='23514'; end if;
  if exists(select 1 from public.publication_variant_assets x where x.variant_id=new.variant_id and x.asset_id<>new.asset_id) then
   raise exception 'Video must be the only media' using errcode='23514'; end if;
 elsif exists(select 1 from public.publication_variant_assets x join public.publication_assets a on a.id=x.asset_id
   where x.variant_id=new.variant_id and a.mime_type='video/mp4') then
  raise exception 'Video must be the only media' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists guard_variant_video on public.publication_variant_assets;
create trigger guard_variant_video before insert on public.publication_variant_assets
 for each row execute function publications_private.guard_variant_video();

-- 4) Studio vidéo : bibliothèque des vidéos motion design créées par client (activité distincte des publications).
--    Les fichiers vivent dans un stockage privé dédié ; une vidéo n'est publiée nulle part sans action explicite.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studio-videos','studio-videos',false,67108864,array['video/mp4'])
on conflict (id) do nothing;
create table if not exists public.studio_videos (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete restrict,
 title text not null check (length(btrim(title)) between 1 and 160),
 script jsonb not null check (jsonb_typeof(script)='object'),
 sources jsonb not null default '{}'::jsonb check (jsonb_typeof(sources)='object'),
 storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
 duration_seconds numeric(5,2) not null check (duration_seconds>0 and duration_seconds<=120),
 size_bytes integer not null check (size_bytes>0 and size_bytes<=67108864),
 width integer not null check (width>0), height integer not null check (height>0),
 created_by text not null check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 last_publication_id uuid references public.publications(id) on delete set null,
 constraint studio_videos_path_client check (split_part(storage_path,'/',1)=client_id::text)
);
create index if not exists studio_videos_client_idx on public.studio_videos(client_id,created_at desc);
alter table public.studio_videos enable row level security;
revoke all on public.studio_videos from public, anon, authenticated;
grant select, insert, update, delete on public.studio_videos to service_role;

revoke all on function publications_private.guard_variant_video() from public, anon, authenticated;
