-- =========================================================================================================
-- PR #40 : application manuelle de supabase/migrations/20261031000000_publications_supervision.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261031000000_publications_supervision.sql (md5 9c1c347088434dc25a532a2e4dd9914a, 7900 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['publications_scheduled_flow']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_supervision' or name ~ '^[0-9]{14}_publications_supervision$')) then
  raise exception 'ARRET : la migration 20261031000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)') is not null then
  raise exception 'ARRET : des objets de la migration 20261031000000 existent déjà, ne pas la rejouer'; end if;


end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Socle Publications, lot 7 : supervision. Une seule fonction ajoutée, « Reprogrammer ». Aucune table modifiée.
--
-- Les liaisons occurrence ↔ publication restent immuables (P3/P4) : reprogrammer ne déplace rien. Comme la
-- planification d'un brouillon (#34), une nouvelle publication est créée sur l'occurrence OUVERTE choisie (même
-- client, projet et plateforme, à venir), par la logique de création unique, avec le texte, les métadonnées et les
-- médias de la révision actuelle ; l'ancienne est archivée (consultable, son créneau reste consommé) et liée par le
-- journal. Approbation : toujours remise à zéro. Une publication en attente ou approuvée repasse « À valider » ; un
-- brouillon reste brouillon. Les diffusions non envoyées sont annulées ; une diffusion en cours, envoyée ou à
-- vérifier bloque la reprogrammation. Une publication refusée n'est jamais reprogrammée. Forward-only.
-- Photothèque (lot 4-5) : une photo de la photothèque du client attachée à la publication (historique
-- whatsapp_asset_uses) doit être encore publiable (publications_private.library_asset_publishable) ; sinon refus clair,
-- rien n'est modifié. L'historique d'utilisation suit la nouvelle publication. Une publication qui repasse « À valider »
-- crée la notification de validation (catégorie publication_review du lot 6, idempotente par publication).
-- Groupe éditorial : non repris. L'ancienne publication (archivée) garde sa liaison immuable au groupe et sur la
-- même plateforme ; l'index unique (groupe, plateforme) interdit donc d'y rattacher la nouvelle sans modifier le socle.
create function public.publication_reschedule(p_publication_id uuid,p_expected_revision_id uuid,p_occurrence_id uuid,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;rev public.publication_revisions;v public.publication_variants;occ public.publication_channel_occurrences;
 created jsonb;new_id uuid;new_revision uuid;new_variant uuid;d uuid;cancelled uuid[]:='{}';
 lib public.whatsapp_assets;lib_id uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_expected_revision_id is null or p_occurrence_id is null then
  raise exception 'Invalid reschedule' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale publication' using errcode='40001'; end if;
 if pub.archived_at is not null then raise exception 'Archived publication' using errcode='55000'; end if;
 if pub.occurrence_id is null or pub.platform is null or pub.project_id is null then raise exception 'Publication not scheduled' using errcode='55000'; end if;
 if pub.status not in('draft','pending_review','approved') then raise exception 'Publication cannot be rescheduled' using errcode='55000'; end if;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status in('processing','published','simulated','uncertain')) then
  raise exception 'Resolve deliveries first' using errcode='55000'; end if;
 select * into occ from public.publication_channel_occurrences where id=p_occurrence_id for update;
 if not found or occ.id=pub.occurrence_id or occ.client_id<>pub.client_id or occ.project_id<>pub.project_id or occ.platform<>pub.platform then
  raise exception 'Invalid occurrence' using errcode='23514'; end if;
 if occ.skipped_at is not null then raise exception 'Occurrence skipped' using errcode='23514'; end if;
 if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23505'; end if;
 if occ.scheduled_for<=now() then raise exception 'Occurrence in the past' using errcode='23514'; end if;
 select * into rev from public.publication_revisions where id=pub.current_revision_id;
 select * into v from public.publication_variants where revision_id=pub.current_revision_id and platform=pub.platform;
 if not found then raise exception 'Variant missing' using errcode='23514'; end if;
 -- Photos de la photothèque attachées : toujours publiables (confidentielle, rejetée, archivée, purgée, hors sujet → refus).
 for lib_id in select distinct u.asset_id from public.publication_variant_assets va
   join public.whatsapp_asset_uses u on u.publication_asset_id=va.asset_id and u.client_id=va.client_id where va.variant_id=v.id loop
  select * into lib from public.whatsapp_assets where id=lib_id and client_id=pub.client_id;
  if not publications_private.library_asset_publishable(lib) then
   raise exception 'Library photo no longer publishable' using errcode='23514'; end if;
 end loop;

 -- Diffusions pas encore envoyées : annulées par la fonction existante (jobs compris, journalisées).
 for d in select id from public.publication_deliveries where publication_id=pub.id and status in('scheduled','retryable_error','blocked') order by id loop
  perform public.publication_delivery_cancel(d,p_actor_id);cancelled:=cancelled||d;
 end loop;

 created:=publications_private.create_publication_from_occurrence(occ.id,null,null,pub.subject,rev.angle,v.text_content,v.metadata,p_actor_id,'manual');
 new_id:=(created->>'publication_id')::uuid;new_revision:=(created->>'revision_id')::uuid;
 select id into new_variant from public.publication_variants where revision_id=new_revision;
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
  select new_variant,va.asset_id,va.client_id,va.sort_order from public.publication_variant_assets va where va.variant_id=v.id order by va.sort_order;
 -- Historique de la photothèque : la nouvelle publication réutilise les mêmes fichiers privés (une ligne par photo).
 insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,publication_asset_id,used_by)
  select distinct on (u.asset_id) u.asset_id,u.client_id,new_id,pub.platform,u.publication_asset_id,p_actor_id
  from public.publication_variant_assets va join public.whatsapp_asset_uses u on u.publication_asset_id=va.asset_id and u.client_id=va.client_id
  where va.variant_id=v.id order by u.asset_id,va.sort_order
 on conflict(asset_id,publication_id,platform) do nothing;
 perform public.publication_archive(pub.id,p_actor_id);
 if pub.status in('pending_review','approved') then
  perform public.publication_submit_manual(new_id,new_revision,p_actor_id);
  -- « À valider » : même notification que la préparation planifiée (aucun texte ni nom de client).
  insert into public.admin_notifications(event_key,category,href) values('publication-review:'||new_id::text,'publication_review','/publications/review')
  on conflict(event_key) do nothing;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.rescheduled',pub.client_id,'publication',pub.id,jsonb_build_object('project_id',pub.project_id,
  'from_occurrence_id',pub.occurrence_id,'to_occurrence_id',occ.id,'publication_id',new_id,'revision_id',new_revision,'source_revision_id',pub.current_revision_id,
  'previous_status',pub.status,'approval_reset',pub.status='approved','cancelled_deliveries',to_jsonb(cancelled)));
 return jsonb_build_object('publication_id',new_id,'revision_id',new_revision,'status',case when pub.status='draft' then 'draft' else 'pending_review' end,
  'archived_source_id',pub.id,'cancelled_deliveries',to_jsonb(cancelled));
end $$;
revoke all on function public.publication_reschedule(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.publication_reschedule(uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'))='973dd25bbf298ededa3846a120364c58',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_reschedule(uuid,uuid,uuid,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_reschedule(uuid,uuid,uuid,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_reschedule(uuid,uuid,uuid,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
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

 raise notice 'Migration 20261031000000 appliquée et vérifiée (% contrôles).', 3;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261031000000 appliquée' as migration, 3 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
