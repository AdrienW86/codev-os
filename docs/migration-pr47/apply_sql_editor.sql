-- =========================================================================================================
-- PR #47 : application manuelle de supabase/migrations/20261106000000_publications_robustness.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261106000000_publications_robustness.sql (md5 0f4662e0a13d46cc9580728b2e71dc71, 4461 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['whatsapp_export_import']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_robustness' or name ~ '^[0-9]{14}_publications_robustness$')) then
  raise exception 'ARRET : la migration 20261106000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])') is not null then
  raise exception 'ARRET : des objets de la migration 20261106000000 existent déjà, ne pas la rejouer'; end if;
 if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'))<>'f250ec2e20baddad4a23ccad5695dca2',true) then
  raise exception 'ARRET : % absente ou différente de la version attendue avant migration', 'public.publication_job_claim_on_time(text,integer,integer)'; end if;

end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_publication_jobs on commit drop as select * from public.publication_jobs;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Socle Publications, phase 8 (#47) : robustesse et charge du pipeline planifié. Rien n'est activé : la diffusion
-- planifiée reste sous son drapeau d'environnement (désactivé par défaut) et sous les interrupteurs en base.
-- Aucune ligne existante modifiée, aucune table créée.

-- 1. Garde de retard (2 h) appliquée aussi aux réessais automatiques. Avant : le retard se mesurait sur run_at, que
-- publication_job_complete repousse à chaque réessai (1 min … 6 h, ou délai imposé par le fournisseur) : un envoi dû à
-- 9 h, en échec temporaire, pouvait partir à 11 h 30 sans aucun humain. Désormais la référence est l'heure due de la
-- diffusion (scheduled_for), ou la dernière relance par un humain (publication.delivery_retried) si elle est plus récente :
-- une tâche dont la référence dépasse la tolérance est bloquée (late_schedule, notifiée, relançable depuis la fiche).
-- Le reste est inchangé (verrou SKIP LOCKED, 50 blocages au plus par appel, puis publication_job_claim telle quelle).
create or replace function public.publication_job_claim_on_time(p_worker_id text,p_lease_seconds integer,p_max_late_seconds integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j record;n integer:=0;late timestamptz;
begin
 if p_max_late_seconds is null or p_max_late_seconds not between 60 and 86400 then raise exception 'Invalid claim' using errcode='22023'; end if;
 if coalesce((select emergency_stop from public.publication_settings limit 1),true) then return null; end if;
 late:=now()-make_interval(secs=>p_max_late_seconds);
 for j in select pj.delivery_id from public.publication_jobs pj join public.publication_deliveries d on d.id=pj.delivery_id
   where pj.type='deliver' and pj.dispatched_at is null
    and (pj.status='pending' or (pj.status='processing' and pj.lease_expires_at<=now()))
    and d.status in('scheduled','retryable_error','processing') and d.revision_id is not null
    and (pj.run_at<late or greatest(d.scheduled_for,(select max(e.created_at) from public.publication_events e
      where e.resource_type='publication' and e.resource_id=d.publication_id and e.action='publication.delivery_retried'
       and e.metadata->>'delivery_id'=d.id::text))<late)
   order by pj.run_at,pj.id limit 50 for update of pj skip locked loop
  perform publications_private.block_delivery(j.delivery_id,'late_schedule');n:=n+1;
 end loop;
 -- Encore des retards à bloquer : rien n'est envoyé dans ce passage (le suivant continue).
 if n=50 then return null; end if;
 return public.publication_job_claim(p_worker_id,p_lease_seconds);
end $$;

-- 2. Réservation du planificateur limitée aux plateformes dont l'envoi tient dans le temps restant du passage.
-- p_platforms nul : comportement de publication_job_claim_on_time. Sinon, la réservation ordinaire (même ordre, mêmes
-- contrôles) est faite dans une sous-transaction ; si la tâche réservée est d'une autre plateforme, tout est annulé et
-- rien n'est réservé : la tâche reste en tête de file pour le passage suivant (jamais doublée par une plus rapide).
create function public.publication_job_claim_scheduled(p_worker_id text,p_lease_seconds integer,p_max_late_seconds integer,p_platforms text[]) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c jsonb;
begin
 if p_platforms is not null and (cardinality(p_platforms) not between 1 and 3 or exists(select 1 from unnest(p_platforms) x
   where x is null or x not in('facebook','instagram','google_business_profile'))) then raise exception 'Invalid claim' using errcode='22023'; end if;
 if p_platforms is null then return public.publication_job_claim_on_time(p_worker_id,p_lease_seconds,p_max_late_seconds); end if;
 begin
  c:=public.publication_job_claim_on_time(p_worker_id,p_lease_seconds,p_max_late_seconds);
  if c is not null and not (c->>'platform'=any(p_platforms)) then raise exception 'Deferred claim' using errcode='PD047'; end if;
  return c;
 exception when sqlstate 'PD047' then return null;
 end;
end $$;

revoke all on function public.publication_job_claim_on_time(text,integer,integer),public.publication_job_claim_scheduled(text,integer,integer,text[]) from public,anon,authenticated;
grant execute on function public.publication_job_claim_on_time(text,integer,integer),public.publication_job_claim_scheduled(text,integer,integer,text[]) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'))='cec5c9f4ebc579c289faa982533cc8a0',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'))='0a250cee5c7f837229ad8c00f8afd59b',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.publication_jobs','_kit_snap_public_publication_jobs',''),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
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

 raise notice 'Migration 20261106000000 appliquée et vérifiée (% contrôles).', 6;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261106000000 appliquée' as migration, 6 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
