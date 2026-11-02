-- Snapchat, cinquième réseau de publication (même circuit : agent, validation humaine, envoi programmé).
-- Fournisseur OAuth « snapchat » (Snap Public Profile API, un ou plusieurs profils publics par connexion) et plateforme
-- « snapchat » : une Story (une photo) ou un Spotlight (une vidéo, par exemple issue du Studio vidéo).
-- 1) Plateforme autorisée partout où les quatre réseaux actuels le sont.
do $$
declare r record;
begin
 for r in select * from (values
  ('publication_accounts','publication_accounts_platform_check','check (platform in (''google_business_profile'',''facebook'',''instagram'',''tiktok'',''snapchat''))'),
  ('publications','publications_platform_check','check (platform is null or platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok'',''snapchat''))'),
  ('publication_variants','publication_variants_platform_check','check (platform in (''google_business_profile'',''facebook'',''instagram'',''tiktok'',''snapchat''))'),
  ('publication_media_uses','publication_media_uses_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok'',''snapchat''))'),
  ('publication_project_channels','publication_project_channels_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok'',''snapchat''))'),
  ('publication_channel_occurrences','publication_channel_occurrences_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok'',''snapchat''))'),
  ('whatsapp_asset_uses','whatsapp_asset_uses_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok'',''snapchat''))')
 ) as t(tbl,con,def) loop
  if to_regclass('public.'||r.tbl) is null then continue; end if;
  execute format('alter table public.%I drop constraint if exists %I',r.tbl,r.con);
  execute format('alter table public.%I add constraint %I %s',r.tbl,r.con,r.def);
 end loop;
end $$;

-- 2) Fournisseur et correspondance fournisseur → plateforme.
create or replace function publications_private.connection_provider(p_provider text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce(p_provider in('meta','google_business_profile','tiktok','snapchat'),false);
$$;
create or replace function publications_private.connection_provider_platform(p_provider text, p_platform text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce((p_provider='meta' and p_platform in('facebook','instagram')) or (p_provider='google_business_profile' and p_platform='google_business_profile')
  or (p_provider='tiktok' and p_platform='tiktok') or (p_provider='snapchat' and p_platform='snapchat'),false);
$$;
-- Snapchat ne publie que des médias (Story photo ou Spotlight vidéo) : un texte seul n'est jamais diffusable.
create or replace function publications_private.platform_requires_media(p_platform text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce(p_platform in('facebook','instagram','google_business_profile','tiktok','snapchat'),false);
$$;

-- 3) Fonctions existantes : la liste des plateformes acceptées gagne « snapchat » (remplacement vérifié, jamais silencieux).
do $$
declare
 patches text[][]:=array[
  array['public.publication_channel_assign_account(uuid,text,uuid,text)',$a$p_platform not in('facebook','instagram','google_business_profile','tiktok')$a$,$b$p_platform not in('facebook','instagram','google_business_profile','tiktok','snapchat')$b$],
  array['public.publication_channel_save(uuid,text,boolean,uuid,text,text)',$a$p_platform not in('facebook','instagram','google_business_profile','tiktok')$a$,$b$p_platform not in('facebook','instagram','google_business_profile','tiktok','snapchat')$b$],
  array['public.publication_client_project_ensure(uuid,text)',$a$array['facebook','instagram','google_business_profile','tiktok']$a$,$b$array['facebook','instagram','google_business_profile','tiktok','snapchat']$b$],
  array['public.publication_job_claim_scheduled(text,integer,integer,text[])',$a$cardinality(p_platforms) not between 1 and 4$a$,$b$cardinality(p_platforms) not between 1 and 5$b$],
  array['public.publication_job_claim_scheduled(text,integer,integer,text[])',$a$x not in('facebook','instagram','google_business_profile','tiktok')$a$,$b$x not in('facebook','instagram','google_business_profile','tiktok','snapchat')$b$],
  array['public.publication_oauth_record(uuid,text,text,text,jsonb,text)',$a$e.key not in('facebook','instagram','google_business_profile','tiktok','accounts')$a$,$b$e.key not in('facebook','instagram','google_business_profile','tiktok','snapchat','accounts')$b$],
  array['public.publication_connections_list(uuid)',$a$'tiktok',count(*) filter(where a.platform='tiktok'))$a$,$b$'tiktok',count(*) filter(where a.platform='tiktok'),'snapchat',count(*) filter(where a.platform='snapchat'))$b$],
  array['public.publication_delivery_reconcile(uuid,text,text,text)',$a$  elsif d.platform='tiktok' then$a$,$b$  elsif d.platform in('tiktok','snapchat') then$b$],
  array['public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text)',$a$  elsif d.platform='tiktok' then$a$,$b$  elsif d.platform in('tiktok','snapchat') then$b$]];
 i int; def text; patched text;
begin
 for i in 1..array_length(patches,1) loop
  def:=pg_get_functiondef(patches[i][1]::regprocedure);
  if position(patches[i][2] in def)=0 then raise exception 'Snapchat patch not applicable: % / %',patches[i][1],left(patches[i][2],60); end if;
  patched:=replace(def,patches[i][2],patches[i][3]);
  execute patched;
 end loop;
end $$;

-- 4) Vidéo : une vidéo MP4 peut aussi être rattachée à une variante Snapchat (Spotlight), toujours seule. Snapchat publie
--    un seul média par Story ou Spotlight : une variante Snapchat porte au plus un média.
create or replace function publications_private.guard_variant_video() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare is_video boolean; platform text;
begin
 select a.mime_type='video/mp4' into is_video from public.publication_assets a where a.id=new.asset_id and a.client_id=new.client_id;
 select v.platform into platform from public.publication_variants v where v.id=new.variant_id;
 if platform='snapchat' and exists(select 1 from public.publication_variant_assets x where x.variant_id=new.variant_id and x.asset_id<>new.asset_id) then
  raise exception 'Snapchat takes one media' using errcode='23514'; end if;
 if coalesce(is_video,false) then
  if platform is null or platform not in('tiktok','snapchat') then raise exception 'Video only on TikTok or Snapchat' using errcode='23514'; end if;
  if exists(select 1 from public.publication_variant_assets x where x.variant_id=new.variant_id and x.asset_id<>new.asset_id) then
   raise exception 'Video must be the only media' using errcode='23514'; end if;
 elsif exists(select 1 from public.publication_variant_assets x join public.publication_assets a on a.id=x.asset_id
   where x.variant_id=new.variant_id and a.mime_type='video/mp4') then
  raise exception 'Video must be the only media' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function publications_private.guard_variant_video() from public, anon, authenticated;
