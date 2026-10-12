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
