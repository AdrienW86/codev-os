-- Socle Publications, lot 6 : préparation planifiée, validation humaine et diffusion à l'heure prévue.
-- Le moteur de diffusion (P10-P13) est inchangé : seules les notifications sont ajoutées. Une publication n'est
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
create trigger publication_delivery_failure_notification after update of status on public.publication_deliveries
 for each row when (new.status in ('failed','uncertain') and old.status is distinct from new.status)
 execute function publications_private.delivery_failure_notification();

revoke all on function publications_private.delivery_failure_notification() from public,anon,authenticated,service_role;
grant execute on function publications_private.delivery_failure_notification() to service_role;
notify pgrst, 'reload schema';
