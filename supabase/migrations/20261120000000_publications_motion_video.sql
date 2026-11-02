-- Vidéos motion design pour TikTok : une vidéo MP4 générée par CODE-V OS à partir des photos et du texte d'une
-- publication TikTok remplace ces photos dans une NOUVELLE révision (origine « manual »), qui repasse « À valider » :
-- un humain voit la vidéo, choisit la confidentialité TikTok et consent avant toute diffusion (règle TikTok inchangée).
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

-- 4) Réglage par client : générer automatiquement la vidéo des publications TikTok préparées par l'agent.
alter table public.publication_client_settings add column if not exists tiktok_motion_video boolean not null default false;
create or replace function public.publication_motion_video_save(p_client_id uuid, p_enabled boolean, p_actor_id text)
returns void language plpgsql set search_path to 'pg_catalog' as $$
declare previous boolean;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or p_enabled is null then
  raise exception 'Invalid motion video setting' using errcode='22023'; end if;
 select tiktok_motion_video into previous from public.publication_client_settings where client_id=p_client_id for update;
 if not found then raise exception 'Client settings missing' using errcode='23514'; end if;
 if previous is distinct from p_enabled then
  update public.publication_client_settings set tiktok_motion_video=p_enabled where client_id=p_client_id;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
  values('admin',p_actor_id,'publication.motion_video_setting_saved',p_client_id,'client',p_client_id,
   jsonb_build_object('tiktok_motion_video',previous),jsonb_build_object('tiktok_motion_video',p_enabled),'{}'::jsonb);
 end if;
end $$;

-- 5) Publications TikTok à mettre en vidéo : préparées par l'agent (révision « generated »), « À valider », photos
--    seulement, client ayant activé le réglage, créneau à venir, aucun échec déjà enregistré pour cette révision.
create or replace function public.publication_motion_video_candidates(p_now timestamptz, p_limit integer)
returns table(publication_id uuid, revision_id uuid, client_id uuid)
language sql stable set search_path to 'pg_catalog' as $$
 select p.id,p.current_revision_id,p.client_id
 from public.publications p
 join public.publication_client_settings s on s.client_id=p.client_id and s.tiktok_motion_video
 join public.publication_revisions r on r.id=p.current_revision_id and r.publication_id=p.id and r.origin='generated'
 join public.publication_variants v on v.revision_id=r.id and v.platform='tiktok'
 left join public.publication_channel_occurrences o on o.id=p.occurrence_id
 where p_now is not null and p.platform='tiktok' and p.status='pending_review' and p.archived_at is null
  and (o.id is null or (o.skipped_at is null and o.scheduled_for>p_now))
  and exists(select 1 from public.publication_variant_assets x join public.publication_assets a on a.id=x.asset_id
   where x.variant_id=v.id and a.mime_type in('image/jpeg','image/webp','image/png'))
  and not exists(select 1 from public.publication_variant_assets x join public.publication_assets a on a.id=x.asset_id
   where x.variant_id=v.id and a.mime_type='video/mp4')
  and not exists(select 1 from public.publication_events e where e.resource_type='publication' and e.resource_id=p.id
   and e.action='publication.motion_video_failed' and e.metadata->>'revision_id'=r.id::text)
 order by o.scheduled_for nulls last,p.id
 limit least(greatest(coalesce(p_limit,0),1),20);
$$;

-- 6) Échec de génération journalisé (code court, jamais de détail technique) : la révision n'est plus reprise
--    automatiquement ; un humain peut relancer depuis l'écran de validation.
create or replace function public.publication_motion_video_failed(p_publication_id uuid, p_revision_id uuid, p_code text, p_actor_id text)
returns void language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications;
begin
 if p_code is null or p_code !~ '^[a-z_]{1,40}$' or (p_actor_id is not null and p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$') then
  raise exception 'Invalid motion video failure' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id;
 if not found then raise exception 'Publication missing' using errcode='23514'; end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values(case when p_actor_id is null then 'system' else 'admin' end,p_actor_id,'publication.motion_video_failed',pub.client_id,'publication',pub.id,
  jsonb_build_object('revision_id',p_revision_id,'code',p_code));
end $$;

revoke all on function publications_private.guard_variant_video() from public, anon, authenticated;
revoke all on function public.publication_motion_video_save(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.publication_motion_video_candidates(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.publication_motion_video_failed(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.publication_motion_video_save(uuid,boolean,text) to service_role;
grant execute on function public.publication_motion_video_candidates(timestamptz,integer) to service_role;
grant execute on function public.publication_motion_video_failed(uuid,uuid,text,text) to service_role;
