-- =========================================================================================================
-- PR #42 : application manuelle de supabase/migrations/20261102000000_publications_editorial_intelligence.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261102000000_publications_editorial_intelligence.sql (md5 3b2de8f168d15f3ea1625cb634f47d4e, 3667 octets).
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
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_editorial_intelligence' or name ~ '^[0-9]{14}_publications_editorial_intelligence$')) then
  raise exception 'ARRET : la migration 20261102000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)') is not null
  or to_regprocedure('publications_private.guard_agent_v2_justification()') is not null
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.publication_agent_v2_runs') and attname='editorial_justification' and not attisdropped)
  or to_regclass('public.publication_agent_v2_runs_publications') is not null
  or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_agent_v2_runs') and tgname='agent_v2_run_justification_guard') then
  raise exception 'ARRET : des objets de la migration 20261102000000 existent déjà, ne pas la rejouer'; end if;


end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_publication_agent_v2_runs on commit drop as select * from public.publication_agent_v2_runs;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Socle Publications, PR #42 : intelligence éditoriale de l'Agent v2. Migration additive.
-- 1. Justification éditoriale d'une préparation (pourquoi ce sujet, cette photo, quel historique a été considéré, quelles
--    prestations ont été écartées et pourquoi, ou motif du refus) enregistrée avec le run, en lecture seule ensuite.
-- 2. Index de lecture « run d'une publication » pour le panneau de la publication.
-- Aucune ligne existante n'est modifiée (colonne nullable sans défaut) ; rien n'est activé ; aucune publication.

-- 1. Colonne : objet JSON borné (16 000 octets), posé une seule fois, uniquement pendant la préparation.
alter table public.publication_agent_v2_runs
 add column editorial_justification jsonb
 constraint publication_agent_v2_runs_justification_shape check(editorial_justification is null
  or (jsonb_typeof(editorial_justification)='object' and octet_length(editorial_justification::text)<=16000));
create index publication_agent_v2_runs_publications on public.publication_agent_v2_runs using gin(publication_ids);

-- Immuable : jamais modifiée une fois posée, jamais posée après la fin du run (le garde historique du run reste inchangé).
create function publications_private.guard_agent_v2_justification() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if new.editorial_justification is distinct from old.editorial_justification
  and (old.editorial_justification is not null or old.status<>'processing') then
  raise exception 'Editorial justification is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger agent_v2_run_justification_guard before update of editorial_justification on public.publication_agent_v2_runs
 for each row execute function publications_private.guard_agent_v2_justification();

-- 2. Enregistrement par le serveur (Agent v2), avant la fin du run : version, issue et contenu bornés.
create function public.publication_editorial_justification_record(p_run_id uuid,p_justification jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_justification is null
  or jsonb_typeof(p_justification) is distinct from 'object' or octet_length(p_justification::text)>16000
  or jsonb_typeof(p_justification->'version') is distinct from 'number'
  or coalesce(p_justification->>'outcome','') not in('prepared','refused') then
  raise exception 'Invalid editorial justification' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if r.id is null then raise exception 'Agent run not found' using errcode='22023'; end if;
 if r.status<>'processing' or r.editorial_justification is not null then
  raise exception 'Editorial justification is immutable' using errcode='55000'; end if;
 update public.publication_agent_v2_runs set editorial_justification=p_justification where id=r.id;
 return jsonb_build_object('run_id',r.id,'recorded',true);
end $$;

-- 3. Droits : service_role uniquement.
revoke all on function publications_private.guard_agent_v2_justification() from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_agent_v2_justification() to service_role;
revoke all on function public.publication_editorial_justification_record(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_editorial_justification_record(uuid,jsonb,text) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'))='596be343a7d3aead14093798b1d55f41',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('publications_private.guard_agent_v2_justification()'))='0f2748ec99a6b68dc948145291b915ad',false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.guard_agent_v2_justification() : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('publications_private.guard_agent_v2_justification()')),false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.guard_agent_v2_justification() : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.guard_agent_v2_justification() : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.publication_agent_v2_runs') and a.attname='editorial_justification' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='jsonb' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.publication_agent_v2_runs.editorial_justification : jsonb'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_agent_v2_runs_publications') and indrelid=to_regclass('public.publication_agent_v2_runs') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.publication_agent_v2_runs_publications sur public.publication_agent_v2_runs : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.publication_agent_v2_runs') and conname='publication_agent_v2_runs_justification_shape' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte publication_agent_v2_runs_justification_shape sur public.publication_agent_v2_runs : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_agent_v2_runs') and tgname='agent_v2_run_justification_guard' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.guard_agent_v2_justification()'))) then raise exception 'VERIFICATION : %', 'déclencheur agent_v2_run_justification_guard sur public.publication_agent_v2_runs : présent, actif, appelle publications_private.guard_agent_v2_justification()'; end if;
 if not (not exists(select 1 from public.publication_agent_v2_runs where editorial_justification is not null)) then raise exception 'VERIFICATION : %', 'justification éditoriale : colonne nullable, aucune ligne existante renseignée'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.publication_agent_v2_runs','_kit_snap_public_publication_agent_v2_runs',''),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
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

 raise notice 'Migration 20261102000000 appliquée et vérifiée (% contrôles).', 11;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261102000000 appliquée' as migration, 11 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
