-- Réglages TikTok d'une publication, choisis par l'humain qui valide (règles « Direct Post » de TikTok) :
-- confidentialité (sans valeur par défaut), commentaires, divulgation de contenu commercial, consentement explicite.
-- Un jeu de réglages par révision approuvée ; la diffusion lit ceux de la révision figée dans la diffusion.
create table if not exists public.publication_tiktok_settings (
 revision_id uuid primary key references public.publication_revisions(id) on delete restrict,
 publication_id uuid not null references public.publications(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict,
 privacy_level text not null check (privacy_level in ('PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY')),
 allow_comment boolean not null default false,
 brand_organic boolean not null default false,
 brand_content boolean not null default false,
 consented_by text not null check (consented_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 consented_at timestamptz not null default now(),
 check (not (brand_content and privacy_level='SELF_ONLY'))
);
alter table public.publication_tiktok_settings enable row level security;
revoke all on public.publication_tiktok_settings from public, anon, authenticated;
grant select, insert, update on public.publication_tiktok_settings to service_role;

create or replace function public.publication_tiktok_settings_save(p_publication_id uuid, p_revision_id uuid, p_privacy_level text,
 p_allow_comment boolean, p_brand_organic boolean, p_brand_content boolean, p_actor_id text)
returns void language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_revision_id is null
  or p_privacy_level not in ('PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY')
  or p_allow_comment is null or p_brand_organic is null or p_brand_content is null
  or (p_brand_content and p_privacy_level='SELF_ONLY') then
  raise exception 'Invalid TikTok settings' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.platform is distinct from 'tiktok' or pub.archived_at is not null then raise exception 'Not a TikTok publication' using errcode='23514'; end if;
 if pub.current_revision_id is distinct from p_revision_id then raise exception 'Stale revision' using errcode='55000'; end if;
 insert into public.publication_tiktok_settings(revision_id,publication_id,client_id,privacy_level,allow_comment,brand_organic,brand_content,consented_by,consented_at)
 values(p_revision_id,pub.id,pub.client_id,p_privacy_level,p_allow_comment,p_brand_organic,p_brand_content,p_actor_id,now())
 on conflict (revision_id) do update set privacy_level=excluded.privacy_level,allow_comment=excluded.allow_comment,brand_organic=excluded.brand_organic,
  brand_content=excluded.brand_content,consented_by=excluded.consented_by,consented_at=excluded.consented_at;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.tiktok_settings_saved',pub.client_id,'publication',pub.id,
  jsonb_build_object('revision_id',p_revision_id,'privacy_level',p_privacy_level,'allow_comment',p_allow_comment,'brand_organic',p_brand_organic,'brand_content',p_brand_content));
end $$;
revoke all on function public.publication_tiktok_settings_save(uuid,uuid,text,boolean,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.publication_tiktok_settings_save(uuid,uuid,text,boolean,boolean,boolean,text) to service_role;
