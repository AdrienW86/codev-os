-- =========================================================================================================
-- PR #39 : application manuelle de supabase/migrations/20261030000000_publications_scheduled_flow.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261030000000_publications_scheduled_flow.sql (md5 20fd07ce0b96d799894b03ab3017526b, 11821 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['publications_editorial_selection']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_scheduled_flow' or name ~ '^[0-9]{14}_publications_scheduled_flow$')) then
  raise exception 'ARRET : la migration 20261030000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)') is not null
  or to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)') is not null
  or to_regprocedure('publications_private.delivery_failure_notification()') is not null
  or to_regclass('public.publication_scheduled_runs') is not null
  or to_regclass('public.scheduler_heartbeats') is not null
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.publication_client_settings') and attname='last_auto_prepared_at' and not attisdropped)
  or to_regclass('public.publication_client_settings_auto_rotation') is not null
  or to_regclass('public.publication_scheduled_runs_open') is not null
  or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_deliveries') and tgname='publication_delivery_failure_notification') then
  raise exception 'ARRET : des objets de la migration 20261030000000 existent déjà, ne pas la rejouer'; end if;
 if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.codev_unread_notifications(text)'))<>'c9ee0bebf1535642e31c5dff9b4955f2',true) then
  raise exception 'ARRET : % absente ou différente de la version attendue avant migration', 'public.codev_unread_notifications(text)'; end if;

end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_admin_notifications on commit drop as select * from public.admin_notifications;
create temporary table _kit_snap_public_admin_notification_preferences on commit drop as select * from public.admin_notification_preferences;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Socle Publications, lot 6 : préparation planifiée, validation humaine et diffusion à l'heure prévue.
-- Le moteur de diffusion (P10-P13) est inchangé : notifications, candidates filtrées en base, réservation à l'heure
-- (tolérance de retard), suivi des préparations à reprendre et battement du planificateur sont ajoutés. Une publication n'est
-- diffusée qu'approuvée par un humain ; une modification après approbation la repasse en brouillon et bloque ses
-- diffusions (publication_save_draft, existant) ; un refus n'est jamais diffusé (publication_prepare_delivery).
-- Forward-only. Aucune publication, aucune approbation automatique.

-- 1. Notifications : « Publication à valider » (vers la file de validation) et liens vers une publication.
alter table public.admin_notifications drop constraint admin_notifications_category_check;
alter table public.admin_notifications add constraint admin_notifications_category_check
  check (category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review'));
alter table public.admin_notifications drop constraint admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
  check (href ~ '^/(reports|advertising/analyses|agents|publications)/[0-9a-f-]{36}$' or href='/work?kind=incident' or href='/publications/review'
    or href ~ '^/clients/[0-9a-f-]{36}\?tab=media$' or href='/settings/whatsapp' or href='/notifications');
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_categories_check;
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_push_categories_check;
alter table public.admin_notification_preferences
  add constraint admin_notification_preferences_categories_check check (categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review']),
  add constraint admin_notification_preferences_push_categories_check check (push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review']),
  alter column categories set default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review'];
update public.admin_notification_preferences set categories = array_append(categories, 'publication_review') where not ('publication_review' = any(categories));
create or replace function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),
  array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;

-- 2. Échec ou incertitude d'une diffusion : une notification par diffusion et par état, vers la publication.
-- Aucun texte, compte ni code d'erreur dans la notification (consultables sur la fiche, réservée à l'admin).
create function publications_private.delivery_failure_notification() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 insert into public.admin_notifications(event_key,category,href)
 values('publication-delivery:'||new.id::text||':'||new.status,'delivery_failed','/publications/'||new.publication_id::text)
 on conflict(event_key) do nothing;
 return new;
end $$;
-- Blocage aussi (connexion expirée, refus d'authentification, canal non publiable, retard au-delà de la tolérance :
-- toujours avec un motif) ; jamais pour un blocage causé par un humain (modification après approbation, sans motif ou
-- publication_changed / content_changed, archivage) : rien à signaler.
create trigger publication_delivery_failure_notification after update of status on public.publication_deliveries
 for each row when (new.status in ('failed','uncertain','blocked') and old.status is distinct from new.status
  and (new.status<>'blocked' or (new.blocked_reason is not null and new.blocked_reason not in ('publication_changed','content_changed','archived'))))
 execute function publications_private.delivery_failure_notification();

revoke all on function publications_private.delivery_failure_notification() from public,anon,authenticated,service_role;
grant execute on function publications_private.delivery_failure_notification() to service_role;

-- 3. Rotation équitable des clients en préparation automatique : le moins récemment traité d'abord (null = jamais).
alter table public.publication_client_settings add column last_auto_prepared_at timestamptz;
create index publication_client_settings_auto_rotation on public.publication_client_settings(last_auto_prepared_at nulls first,client_id)
 where auto_prepare_enabled and generation_enabled;

-- 4. Suivi des préparations planifiées dont l'étape média ou la soumission reste à finir (reprise sans IA).
-- open → done (photo attachée et brouillons soumis, ou rien à faire) | gave_up (photo abandonnée, réservation libérée).
create table public.publication_scheduled_runs(
 run_id uuid primary key,
 client_id uuid not null,
 state text not null default 'open' check(state in('open','done','gave_up')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(run_id,client_id) references public.publication_agent_v2_runs(id,client_id) on delete restrict
);
create index publication_scheduled_runs_open on public.publication_scheduled_runs(created_at) where state='open';
alter table public.publication_scheduled_runs enable row level security;
revoke all on public.publication_scheduled_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_scheduled_runs to service_role;

-- 5. Candidates à la diffusion planifiée, filtrées en base : approuvées, non archivées, liées à un créneau, sans
-- diffusion pour leur révision courante. state :
--  ready               créneau à venir (ou passé depuis moins que la tolérance) ;
--  missed              créneau passé au-delà de la tolérance (7 jours au plus), pas encore signalé ;
--  photo_unpublishable photo de la photothèque devenue non publiable (quarantaine, rejet, archivage, purge,
--                      évaluation confidentielle ou hors sujet), pas encore signalée.
-- Une publication signalée n'est plus renvoyée : la liste ne grossit pas avec l'historique.
create function public.publication_scheduled_delivery_candidates(p_late_before timestamptz,p_limit integer)
returns table(publication_id uuid,revision_id uuid,scheduled_for timestamptz,state text)
language sql stable security invoker set search_path=pg_catalog as $$
 select c.publication_id,c.revision_id,c.scheduled_for,c.state from (
  select p.id publication_id,p.current_revision_id revision_id,o.scheduled_for,
   case when o.scheduled_for<p_late_before then 'missed'
    when exists(select 1 from public.whatsapp_asset_uses u join public.whatsapp_assets a on a.id=u.asset_id and a.client_id=u.client_id
     where u.publication_id=p.id and u.client_id=p.client_id and not publications_private.library_asset_publishable(a)
      and (u.publication_asset_id is null or u.publication_asset_id in(select va.asset_id from public.publication_variant_assets va
       join public.publication_variants v on v.id=va.variant_id where v.revision_id=p.current_revision_id and v.publication_id=p.id))) then 'photo_unpublishable'
    else 'ready' end state
  from public.publications p join public.publication_channel_occurrences o on o.id=p.occurrence_id
  where p.status='approved' and p.archived_at is null and p.current_revision_id is not null
   and o.scheduled_for>=p_late_before-interval '7 days'
   and not exists(select 1 from public.publication_deliveries d where d.publication_id=p.id and d.revision_id=p.current_revision_id)) c
 where c.state='ready' or not exists(select 1 from public.admin_notifications n
  where n.event_key='publication-'||replace(c.state,'_','-')||':'||c.publication_id::text||':'||c.revision_id::text)
 order by c.state<>'ready',c.scheduled_for,c.publication_id
 limit least(greatest(coalesce(p_limit,1),1),100);
$$;

-- 6. Réservation du planificateur : jamais d'envoi plus en retard que la tolérance. Les tâches dues depuis plus
-- longtemps (jamais envoyées : sans marqueur d'envoi) sont bloquées avec le motif late_schedule (notifié, relance
-- manuelle possible depuis la fiche), puis la réservation existante (publication_job_claim) s'applique telle quelle.
-- Le bouton du cockpit garde publication_job_claim (un humain décide d'envoyer).
create function public.publication_job_claim_on_time(p_worker_id text,p_lease_seconds integer,p_max_late_seconds integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j record;n integer:=0;
begin
 if p_max_late_seconds is null or p_max_late_seconds not between 60 and 86400 then raise exception 'Invalid claim' using errcode='22023'; end if;
 if coalesce((select emergency_stop from public.publication_settings limit 1),true) then return null; end if;
 for j in select pj.delivery_id from public.publication_jobs pj join public.publication_deliveries d on d.id=pj.delivery_id
   where pj.type='deliver' and pj.dispatched_at is null and pj.run_at<now()-make_interval(secs=>p_max_late_seconds)
    and (pj.status='pending' or (pj.status='processing' and pj.lease_expires_at<=now()))
    and d.status in('scheduled','retryable_error','processing') and d.revision_id is not null
   order by pj.run_at,pj.id limit 50 for update of pj skip locked loop
  perform publications_private.block_delivery(j.delivery_id,'late_schedule');n:=n+1;
 end loop;
 -- Encore des retards à bloquer : rien n'est envoyé dans ce passage (le suivant continue).
 if n=50 then return null; end if;
 return public.publication_job_claim(p_worker_id,p_lease_seconds);
end $$;

-- 7. Battement du planificateur : une ligne par nom (« scheduler_tick »), réécrite à chaque passage. Étapes →
-- {status: ok|failed|skipped|disabled, ms, counts?} ; jamais de texte, d'identifiant ni de contenu. Lot 7 l'affiche.
create table public.scheduler_heartbeats(
 name text primary key check(name ~ '^[a-z][a-z0-9_]{0,39}$'),
 started_at timestamptz not null,
 finished_at timestamptz,
 ok boolean not null default false,
 steps jsonb not null default '{}'::jsonb check(jsonb_typeof(steps)='object' and octet_length(steps::text)<=8192
  and not jsonb_path_exists(steps,'$.* ? (@.type() != "object" || !(@.status == "ok" || @.status == "failed" || @.status == "skipped" || @.status == "disabled"))')),
 last_success_at timestamptz,
 last_failure_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.scheduler_heartbeats enable row level security;
revoke all on public.scheduler_heartbeats from public,anon,authenticated,service_role;
grant select,insert,update on public.scheduler_heartbeats to service_role;

revoke all on function public.publication_scheduled_delivery_candidates(timestamptz,integer),public.publication_job_claim_on_time(text,integer,integer) from public,anon,authenticated;
grant execute on function public.publication_scheduled_delivery_candidates(timestamptz,integer),public.publication_job_claim_on_time(text,integer,integer) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'))='f250ec2e20baddad4a23ccad5695dca2',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'))='d52dc3ee8b9bfe287fa155640598180a',false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('publications_private.delivery_failure_notification()'))='7f8c3597e896d5ba9706f1c2cefe2cbb',false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.delivery_failure_notification() : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('publications_private.delivery_failure_notification()')),false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.delivery_failure_notification() : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction publications_private.delivery_failure_notification() : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.codev_unread_notifications(text)'))='89f33a3d67b18227e584143dfc11f42a',false)) then raise exception 'VERIFICATION : %', 'fonction public.codev_unread_notifications(text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.codev_unread_notifications(text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.codev_unread_notifications(text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.codev_unread_notifications(text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.publication_scheduled_runs')),false)=true) then raise exception 'VERIFICATION : %', 'table public.publication_scheduled_runs : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'SELECT') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'INSERT') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'UPDATE') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.publication_scheduled_runs : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.scheduler_heartbeats')),false)=true) then raise exception 'VERIFICATION : %', 'table public.scheduler_heartbeats : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'SELECT') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'INSERT') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'UPDATE') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.scheduler_heartbeats : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.publication_client_settings') and a.attname='last_auto_prepared_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.publication_client_settings.last_auto_prepared_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_client_settings_auto_rotation') and indrelid=to_regclass('public.publication_client_settings') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.publication_client_settings_auto_rotation sur public.publication_client_settings : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_scheduled_runs_open') and indrelid=to_regclass('public.publication_scheduled_runs') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.publication_scheduled_runs_open sur public.publication_scheduled_runs : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notification_preferences') and conname='admin_notification_preferences_categories_check' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte admin_notification_preferences_categories_check sur public.admin_notification_preferences : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notification_preferences') and conname='admin_notification_preferences_push_categories_check' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte admin_notification_preferences_push_categories_check sur public.admin_notification_preferences : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notifications') and conname='admin_notifications_category_check' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte admin_notifications_category_check sur public.admin_notifications : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notifications') and conname='admin_notifications_href_check' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte admin_notifications_href_check sur public.admin_notifications : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_deliveries') and tgname='publication_delivery_failure_notification' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.delivery_failure_notification()'))) then raise exception 'VERIFICATION : %', 'déclencheur publication_delivery_failure_notification sur public.publication_deliveries : présent, actif, appelle publications_private.delivery_failure_notification()'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.admin_notifications','_kit_snap_public_admin_notifications',''),('public.admin_notification_preferences','_kit_snap_public_admin_notification_preferences','categories'),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
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
 if not (not exists(select 1 from pg_temp._kit_snap_public_admin_notification_preferences s left join public.admin_notification_preferences p on p.user_id=s.user_id where p.user_id is null or p.categories is distinct from (case when 'publication_review'=any(s.categories) then s.categories else array_append(s.categories,'publication_review') end))) then raise exception 'VERIFICATION : %', 'préférences de notification : seule la catégorie publication_review est ajoutée, les autres choix sont conservés'; end if;
 raise notice 'Migration 20261030000000 appliquée et vérifiée (% contrôles).', 24;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261030000000 appliquée' as migration, 24 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
