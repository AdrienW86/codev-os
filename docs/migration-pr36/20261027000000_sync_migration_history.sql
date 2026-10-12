-- =====================================================================================================
-- PR #36 : inscription de la migration 20261027000000_publications_client_setup dans l'historique Supabase,
-- APRES une application manuelle réussie de 20261027000000_apply_sql_editor.sql.
--
-- L'historique de ce projet suit la convention des applications précédentes (connecteur Supabase) : version =
-- horodatage UTC de l'inscription, nom court sans numéro (ex. 20261012083820 publications_schedule_drafts), texte
-- de la migration dans « statements ». Ce script refuse d'écrire si la migration n'est pas réellement en place
-- ou si elle est déjà inscrite. Le texte inscrit est le fichier du dépôt (md5 e21029d6ddf4406a63534cc3367b3e6b).
-- =====================================================================================================
begin;
do $chk$
declare f text;
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name in ('publications_client_setup','20261027000000_publications_client_setup')) then
  raise exception 'ARRET : la migration est déjà inscrite dans l''historique'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='publication_client_settings'
   and column_name in ('auto_prepare_enabled','prepare_lead_days','media_reuse_allowed','media_reuse_after_days','require_human_approval')) <> 5 then
  raise exception 'ARRET : les colonnes de la migration sont absentes, elle n''a pas été appliquée'; end if;
 foreach f in array array['public.publication_client_settings_save(uuid,jsonb,text)','public.publication_client_project_ensure(uuid,text)'] loop
  if to_regprocedure(f) is null then raise exception 'ARRET : % absente, la migration n''a pas été appliquée', f; end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') or not has_function_privilege('service_role', f, 'EXECUTE') then
   raise exception 'ARRET : droits inattendus sur %, vérifier l''application avant d''inscrire', f; end if;
 end loop;
end $chk$;

insert into supabase_migrations.schema_migrations(version, name, statements)
values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'publications_client_setup', array[$migration_20261027$-- Socle Publications multiclient, lot 1 : configuration depuis la fiche client. Migration additive.
-- 1. Réglages Publications du client (publication_client_settings existait sans aucun écrivain applicatif) :
--    préparation automatique, avance de préparation, réemploi explicite des médias, validation humaine verrouillée.
-- 2. RPC d'enregistrement de ces réglages, auditée, sans jamais lever l'arrêt général ni les interrupteurs globaux.
-- 3. RPC idempotente qui retrouve ou crée le projet technique Publications d'un client et ses trois canaux.
-- Aucune ligne existante n'est modifiée ; les clients sans ligne de réglages gardent le comportement actuel (tout désactivé).

alter table public.publication_client_settings
 add column auto_prepare_enabled boolean not null default false,
 add column prepare_lead_days smallint not null default 3 check (prepare_lead_days between 1 and 14),
 add column media_reuse_allowed boolean not null default false,
 add column media_reuse_after_days smallint not null default 180 check (media_reuse_after_days between 30 and 730),
 -- Aucune publication externe sans approbation humaine : la colonne documente la règle, elle ne peut pas être levée.
 add column require_human_approval boolean not null default true check (require_human_approval);

create function public.publication_client_settings_save(p_client_id uuid,p_settings jsonb,p_actor_id text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare previous public.publication_client_settings;saved public.publication_client_settings;existed boolean;
 allowed constant text[]:=array['timezone','publishing_enabled','generation_enabled','auto_prepare_enabled','prepare_lead_days','media_reuse_allowed','media_reuse_after_days','editorial_brief'];
 brief text;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_settings is null or jsonb_typeof(p_settings)<>'object'
  or exists(select 1 from jsonb_object_keys(p_settings) k where k<>all(allowed)) then
  raise exception 'Invalid client settings' using errcode='22023'; end if;
 if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Invalid client' using errcode='23514'; end if;
 if (p_settings ? 'timezone' and jsonb_typeof(p_settings->'timezone')<>'string')
  or exists(select 1 from unnest(array['publishing_enabled','generation_enabled','auto_prepare_enabled','media_reuse_allowed']) k where p_settings ? k and jsonb_typeof(p_settings->k)<>'boolean')
  or exists(select 1 from unnest(array['prepare_lead_days','media_reuse_after_days']) k where p_settings ? k and jsonb_typeof(p_settings->k)<>'number')
  or (p_settings ? 'editorial_brief' and jsonb_typeof(p_settings->'editorial_brief')<>'string') then
  raise exception 'Invalid client settings' using errcode='22023'; end if;
 brief:=case when p_settings ? 'editorial_brief' then btrim(p_settings->>'editorial_brief') end;
 if brief is not null and (length(brief)>10000 or brief ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]') then raise exception 'Invalid client settings' using errcode='22023'; end if;
 -- Verrou par client : deux enregistrements concurrents ne perdent pas de champ.
 perform pg_advisory_xact_lock(hashtextextended('publication_client_settings:'||p_client_id::text,0));
 select * into previous from public.publication_client_settings where client_id=p_client_id for update;
 existed:=found;
 if not existed then insert into public.publication_client_settings(client_id) values(p_client_id) returning * into previous; end if;
 update public.publication_client_settings set
  timezone=coalesce(p_settings->>'timezone',timezone),
  publishing_enabled=coalesce((p_settings->>'publishing_enabled')::boolean,publishing_enabled),
  generation_enabled=coalesce((p_settings->>'generation_enabled')::boolean,generation_enabled),
  auto_prepare_enabled=coalesce((p_settings->>'auto_prepare_enabled')::boolean,auto_prepare_enabled),
  prepare_lead_days=coalesce((p_settings->>'prepare_lead_days')::smallint,prepare_lead_days),
  media_reuse_allowed=coalesce((p_settings->>'media_reuse_allowed')::boolean,media_reuse_allowed),
  media_reuse_after_days=coalesce((p_settings->>'media_reuse_after_days')::smallint,media_reuse_after_days),
  editorial_brief=coalesce(brief,editorial_brief)
 where client_id=p_client_id returning * into saved;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
 values('admin',p_actor_id,'publication.client_settings_saved',p_client_id,'publication_client_settings',saved.id,
  case when existed then jsonb_build_object('timezone',previous.timezone,'publishing_enabled',previous.publishing_enabled,'generation_enabled',previous.generation_enabled,
   'auto_prepare_enabled',previous.auto_prepare_enabled,'prepare_lead_days',previous.prepare_lead_days,'media_reuse_allowed',previous.media_reuse_allowed,
   'media_reuse_after_days',previous.media_reuse_after_days,'has_brief',previous.editorial_brief<>'') end,
  jsonb_build_object('timezone',saved.timezone,'publishing_enabled',saved.publishing_enabled,'generation_enabled',saved.generation_enabled,
   'auto_prepare_enabled',saved.auto_prepare_enabled,'prepare_lead_days',saved.prepare_lead_days,'media_reuse_allowed',saved.media_reuse_allowed,
   'media_reuse_after_days',saved.media_reuse_after_days,'has_brief',saved.editorial_brief<>''),
  jsonb_build_object('created',not existed));
 return saved.id;
end $$;
revoke all on function public.publication_client_settings_save(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_client_settings_save(uuid,jsonb,text) to service_role;

-- Projet technique Publications d'un client : le plus ancien projet éligible existant, sinon un projet « Réseaux
-- sociaux » créé avec ses trois canaux explicites et désactivés (l'administrateur coche ceux qu'il veut).
-- Idempotent : verrou par client, deux appels simultanés renvoient le même projet.
create function public.publication_client_project_ensure(p_client_id uuid,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare found_id uuid;client_name text;platform text;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023'; end if;
 select name into client_name from public.clients where id=p_client_id;
 if not found then raise exception 'Invalid client' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('publication_client_project:'||p_client_id::text,0));
 select id into found_id from public.projects where client_id=p_client_id and publications_private.project_publications_eligible(type)
  order by created_at,id limit 1;
 if found_id is not null then return jsonb_build_object('project_id',found_id,'created',false); end if;
 insert into public.projects(client_id,name,type,status,priority,progress)
 values(p_client_id,left('Publications — '||coalesce(nullif(btrim(client_name),''),'client'),200),'Réseaux sociaux','En cours','Moyenne',0)
 returning id into found_id;
 foreach platform in array array['facebook','instagram','google_business_profile'] loop
  perform public.publication_channel_save(found_id,platform,false,null,null,p_actor_id);
 end loop;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.client_project_created',p_client_id,'project',found_id,jsonb_build_object('source','client_page'));
 return jsonb_build_object('project_id',found_id,'created',true);
end $$;
revoke all on function public.publication_client_project_ensure(uuid,text) from public,anon,authenticated;
grant execute on function public.publication_client_project_ensure(uuid,text) to service_role;
$migration_20261027$]);

do $md5$
begin
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name = 'publications_client_setup') <> 'e21029d6ddf4406a63534cc3367b3e6b' then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
end $md5$;
commit;

select version, name, md5(statements[1]) as md5_texte from supabase_migrations.schema_migrations order by version desc limit 3;
