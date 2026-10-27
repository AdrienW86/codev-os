-- TikTok, quatrième réseau de publication (même circuit : agent, photo carrée, validation humaine, envoi programmé).
-- Fournisseur OAuth « tiktok » (TikTok Login Kit, un compte par client) et plateforme « tiktok » (posts photo).
-- 1) Plateforme autorisée partout où les trois réseaux actuels le sont.
do $$
declare r record;
begin
 for r in select * from (values
  ('publication_accounts','publication_accounts_platform_check','check (platform in (''google_business_profile'',''facebook'',''instagram'',''tiktok''))'),
  ('publications','publications_platform_check','check (platform is null or platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok''))'),
  ('publication_variants','publication_variants_platform_check','check (platform in (''google_business_profile'',''facebook'',''instagram'',''tiktok''))'),
  ('publication_media_uses','publication_media_uses_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok''))'),
  ('publication_project_channels','publication_project_channels_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok''))'),
  ('publication_channel_occurrences','publication_channel_occurrences_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok''))'),
  ('whatsapp_asset_uses','whatsapp_asset_uses_platform_check','check (platform in (''facebook'',''instagram'',''google_business_profile'',''tiktok''))')
 ) as t(tbl,con,def) loop
  if to_regclass('public.'||r.tbl) is null then continue; end if;
  execute format('alter table public.%I drop constraint if exists %I',r.tbl,r.con);
  execute format('alter table public.%I add constraint %I %s',r.tbl,r.con,r.def);
 end loop;
end $$;

-- 2) Fournisseur et correspondance fournisseur → plateforme.
create or replace function publications_private.connection_provider(p_provider text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce(p_provider in('meta','google_business_profile','tiktok'),false);
$$;
create or replace function publications_private.connection_provider_platform(p_provider text, p_platform text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce((p_provider='meta' and p_platform in('facebook','instagram')) or (p_provider='google_business_profile' and p_platform='google_business_profile')
  or (p_provider='tiktok' and p_platform='tiktok'),false);
$$;
-- TikTok ne publie que des médias (posts photo) : un texte seul n'est jamais diffusable.
create or replace function publications_private.platform_requires_media(p_platform text)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
 select coalesce(p_platform in('facebook','instagram','google_business_profile','tiktok'),false);
$$;

-- 3) Fonctions existantes : la liste des plateformes acceptées gagne « tiktok » (remplacement vérifié, jamais silencieux).
do $$
declare
 patches text[][]:=array[
  array['public.publication_channel_assign_account(uuid,text,uuid,text)',$a$p_platform not in('facebook','instagram','google_business_profile')$a$,$b$p_platform not in('facebook','instagram','google_business_profile','tiktok')$b$],
  array['public.publication_channel_save(uuid,text,boolean,uuid,text,text)',$a$p_platform not in('facebook','instagram','google_business_profile')$a$,$b$p_platform not in('facebook','instagram','google_business_profile','tiktok')$b$],
  array['public.publication_client_project_ensure(uuid,text)',$a$array['facebook','instagram','google_business_profile']$a$,$b$array['facebook','instagram','google_business_profile','tiktok']$b$],
  array['public.publication_job_claim_scheduled(text,integer,integer,text[])',$a$cardinality(p_platforms) not between 1 and 3$a$,$b$cardinality(p_platforms) not between 1 and 4$b$],
  array['public.publication_job_claim_scheduled(text,integer,integer,text[])',$a$x not in('facebook','instagram','google_business_profile')$a$,$b$x not in('facebook','instagram','google_business_profile','tiktok')$b$],
  array['public.publication_oauth_record(uuid,text,text,text,jsonb,text)',$a$e.key not in('facebook','instagram','google_business_profile','accounts')$a$,$b$e.key not in('facebook','instagram','google_business_profile','tiktok','accounts')$b$],
  array['public.publication_connections_list(uuid)',$a$'google_business_profile',count(*) filter(where a.platform='google_business_profile'))$a$,$b$'google_business_profile',count(*) filter(where a.platform='google_business_profile'),'tiktok',count(*) filter(where a.platform='tiktok'))$b$],
  array['public.publication_delivery_reconcile(uuid,text,text,text)',$a$  else raise exception 'Invalid reconciliation' using errcode='22023';$a$,$b$  elsif d.platform='tiktok' then
   if p_remote_id !~ '^[A-Za-z0-9_.~:-]{1,200}$' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  else raise exception 'Invalid reconciliation' using errcode='22023';$b$],
  array['public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text)',$a$  else raise exception 'Invalid reconciliation' using errcode='22023'; end if;$a$,$b$  elsif d.platform='tiktok' then
   if p_remote_id !~ '^[A-Za-z0-9_.~:-]{1,200}$' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  else raise exception 'Invalid reconciliation' using errcode='22023'; end if;$b$]];
 i int; def text; patched text;
begin
 for i in 1..array_length(patches,1) loop
  def:=pg_get_functiondef(patches[i][1]::regprocedure);
  if position(patches[i][2] in def)=0 then raise exception 'TikTok patch not applicable: % / %',patches[i][1],left(patches[i][2],60); end if;
  patched:=replace(def,patches[i][2],patches[i][3]);
  execute patched;
 end loop;
end $$;
