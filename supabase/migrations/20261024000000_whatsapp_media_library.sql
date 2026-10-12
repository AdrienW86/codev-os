-- Photothèque WhatsApp (suite du lot whatsapp_drive_ingestion) : vidéos, message associé, affectation explicite
-- des numéros inconnus, statuts éditoriaux, historique d'utilisation, notifications internes et conservation.
-- Les originaux restent uniquement dans Drive ; la base ne stocke que des métadonnées et une miniature privée.

-- 1. File d'import : vidéos, légende WhatsApp, affectation manuelle et rejet explicite.
alter table public.whatsapp_inbox drop constraint whatsapp_inbox_mime_type_check;
alter table public.whatsapp_inbox add constraint whatsapp_inbox_mime_type_check
  check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/3gpp'));
alter table public.whatsapp_inbox drop constraint whatsapp_inbox_status_check;
alter table public.whatsapp_inbox add constraint whatsapp_inbox_status_check
  check (status in ('pending','processing','imported','duplicate','failed','dismissed'));
-- Effaçable sur demande (données personnelles) : une ligne sans expéditeur n'est plus jamais réservée.
alter table public.whatsapp_inbox alter column sender drop not null;
alter table public.whatsapp_inbox
  add column caption text check (caption is null or length(caption) <= 3000),
  add column assigned_by text check (assigned_by is null or assigned_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  add column assigned_at timestamptz,
  add column asset_id uuid references public.whatsapp_assets(id) on delete set null,
  add check ((assigned_by is null) = (assigned_at is null));
create index whatsapp_inbox_unassigned on public.whatsapp_inbox (created_at desc) where client_id is null and status = 'pending';

-- 2. Fichiers importés = entrées de la photothèque (un fichier Drive par client, dossier et empreinte SHA-256).
alter table public.whatsapp_assets drop constraint whatsapp_assets_mime_type_check;
alter table public.whatsapp_assets drop constraint whatsapp_assets_size_check;
alter table public.whatsapp_assets
  add constraint whatsapp_assets_mime_type_check check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/3gpp')),
  add constraint whatsapp_assets_size_check check (size between 1 and 16777216),
  add constraint whatsapp_assets_id_client unique (id, client_id),
  add column media_kind text not null default 'image' check (media_kind in ('image','video')),
  -- Renseigné uniquement après vérification du fichier dans Drive (l'ID est réservé avant l'upload).
  add column imported_at timestamptz,
  add column library_status text not null default 'received' check (library_status in ('received','to_review','validated','used','archived')),
  add column status_changed_at timestamptz not null default now(),
  add column status_changed_by text check (status_changed_by is null or length(status_changed_by) between 1 and 200),
  add column caption text check (caption is null or length(caption) <= 3000),
  add column sender text check (sender is null or sender ~ '^[1-9][0-9]{7,14}$'),
  add column received_at timestamptz,
  add column width integer check (width is null or width between 1 and 100000),
  add column height integer check (height is null or height between 1 and 100000),
  -- Miniature privée (bucket whatsapp-thumbnails) : chemin client/asset, jamais l'original.
  add column thumbnail_path text check (thumbnail_path is null or thumbnail_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');
create index whatsapp_assets_library on public.whatsapp_assets (client_id, imported_at desc) where imported_at is not null;

-- Reprise de l'existant : fichiers déjà importés par le premier lot.
update public.whatsapp_assets a set imported_at = coalesce(i.received_at, a.created_at), received_at = i.received_at
from (select drive_file_id, min(received_at) as received_at from public.whatsapp_inbox where status in ('imported','duplicate') and drive_file_id is not null group by drive_file_id) i
where i.drive_file_id = a.drive_file_id;
update public.whatsapp_inbox i set asset_id = a.id from public.whatsapp_assets a where a.drive_file_id = i.drive_file_id and i.asset_id is null;

-- 3. Historique d'utilisation (évite les réemplois involontaires). Même client garanti par les clés composites.
create table public.whatsapp_asset_uses (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  publication_id uuid not null,
  platform text not null check (platform in ('facebook','instagram','google_business_profile')),
  publication_asset_id uuid,
  used_by text not null check (length(used_by) between 1 and 200),
  used_at timestamptz not null default now(),
  foreign key (asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete restrict,
  foreign key (publication_id, client_id) references public.publications(id, client_id) on delete restrict,
  foreign key (publication_asset_id, client_id) references public.publication_assets(id, client_id) on delete restrict,
  unique (asset_id, publication_id, platform)
);
create index whatsapp_asset_uses_asset on public.whatsapp_asset_uses (client_id, asset_id, used_at desc);

-- 4. Miniatures privées (aucune politique : accès service_role et URL signées courtes uniquement).
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-thumbnails', 'whatsapp-thumbnails', false, 262144, array['image/webp']);

-- 5. Réservation : expéditeur associé (comme avant) OU ligne affectée explicitement par un administrateur.
create or replace function public.whatsapp_claim(p_lease uuid) returns setof public.whatsapp_inbox
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update public.whatsapp_inbox set status='failed', error_code='retry_exhausted', lease=null, lease_until=null
  where status='processing' and lease_until < now() and attempts=5;
  return query
  with candidate as (
    select i.id, coalesce(i.client_id,s.client_id) as client_id, coalesce(i.drive_folder_id,s.drive_folder_id) as folder
    from public.whatsapp_inbox i left join public.whatsapp_senders s on s.sender=i.sender
    where i.sender is not null
      and ((i.assigned_by is not null and i.client_id is not null)
        or (s.enabled and s.rights_confirmed and (i.client_id is null or (i.client_id=s.client_id and i.drive_folder_id=s.drive_folder_id))))
      and i.attempts < 5 and i.retry_at <= now()
      and (i.status='pending' or (i.status='processing' and i.lease_until < now()))
    order by i.created_at, i.id limit 1 for update of i skip locked
  )
  update public.whatsapp_inbox i set status='processing', client_id=c.client_id, drive_folder_id=c.folder,
    attempts=i.attempts+1, lease=p_lease, lease_until=now()+interval '5 minutes', error_code=null
  from candidate c where i.id=c.id returning i.*;
end $$;

-- Affectation d'un média en attente : uniquement vers un couple client/dossier déjà associé avec droits confirmés.
create function public.whatsapp_assign(p_inbox_id uuid, p_client_id uuid, p_folder text, p_actor_id text) returns public.whatsapp_inbox
language plpgsql security invoker set search_path = pg_catalog as $$
declare r public.whatsapp_inbox;
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(7420913);
  if not exists(select 1 from public.whatsapp_senders where client_id=p_client_id and drive_folder_id=p_folder and rights_confirmed) then
    raise exception 'Unknown client folder' using errcode='23514';
  end if;
  update public.whatsapp_inbox set client_id=p_client_id, drive_folder_id=p_folder, assigned_by=p_actor_id, assigned_at=now(),
    status='pending', attempts=0, error_code=null, retry_at=now()
  where id=p_inbox_id and client_id is null and status='pending' and sender is not null
  returning * into r;
  if not found then raise exception 'Not assignable' using errcode='55000'; end if;
  return r;
end $$;

-- 6. Notifications internes : nouveaux médias importés (par client) et médias en attente d'affectation.
alter table public.admin_notifications drop constraint admin_notifications_category_check;
alter table public.admin_notifications add constraint admin_notifications_category_check
  check (category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received'));
alter table public.admin_notifications drop constraint admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
  check (href ~ '^/(reports|advertising/analyses|agents)/[0-9a-f-]{36}$' or href='/work?kind=incident'
    or href ~ '^/clients/[0-9a-f-]{36}\?tab=media$' or href='/settings/whatsapp');
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_categories_check;
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_push_categories_check;
alter table public.admin_notification_preferences
  add constraint admin_notification_preferences_categories_check check (categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received']),
  add constraint admin_notification_preferences_push_categories_check check (push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received']),
  alter column categories set default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received'];
-- Visible par défaut dans le centre de notifications ; le push reste un choix explicite.
update public.admin_notification_preferences set categories = array_append(categories, 'media_received') where not ('media_received' = any(categories));
create or replace function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;

-- Une notification au plus par client et par heure : pas de nom, de numéro ni de message dans la notification.
create function codev_private.whatsapp_notification_event() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare bucket text := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
begin
  if tg_op='UPDATE' and new.status='imported' and old.status<>'imported' and new.client_id is not null then
    insert into public.admin_notifications(event_key, category, href)
    values ('whatsapp:'||new.client_id||':'||bucket, 'media_received', '/clients/'||new.client_id||'?tab=media') on conflict(event_key) do nothing;
  elsif tg_op='INSERT' and new.client_id is null and new.sender is not null
    and not exists(select 1 from public.whatsapp_senders s where s.sender=new.sender and s.enabled and s.rights_confirmed) then
    insert into public.admin_notifications(event_key, category, href)
    values ('whatsapp:unassigned:'||bucket, 'media_received', '/settings/whatsapp') on conflict(event_key) do nothing;
  end if;
  return new;
end $$;
create trigger whatsapp_notify_received after insert on public.whatsapp_inbox for each row execute function codev_private.whatsapp_notification_event();
create trigger whatsapp_notify_imported after update of status on public.whatsapp_inbox for each row execute function codev_private.whatsapp_notification_event();

-- 7. Données personnelles : effacement d'un numéro et purge des messages après la durée de conservation.
create function public.whatsapp_forget_sender(p_sender text, p_actor_id text) returns integer
language plpgsql security invoker set search_path = pg_catalog as $$
declare affected integer;
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023'; end if;
  if p_sender is null or p_sender !~ '^[1-9][0-9]{7,14}$' then raise exception 'Invalid sender' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(7420913);
  delete from public.whatsapp_senders where sender=p_sender;
  -- Les médias non encore importés ne seront plus traités ; les fichiers Drive déjà importés restent (suppression manuelle).
  update public.whatsapp_inbox set status='dismissed', lease=null, lease_until=null where sender=p_sender and status in ('pending','processing');
  update public.whatsapp_inbox set sender=null, caption=null where sender=p_sender;
  get diagnostics affected = row_count;
  update public.whatsapp_assets set sender=null, caption=null where sender=p_sender;
  return affected;
end $$;
create function public.whatsapp_purge_personal_data(p_before timestamptz) returns integer
language plpgsql security invoker set search_path = pg_catalog as $$
declare affected integer; archived integer;
begin
  if p_before is null or p_before > now() - interval '7 days' then raise exception 'Retention too short' using errcode='22023'; end if;
  update public.whatsapp_inbox set sender=null, caption=null
  where received_at < p_before and status in ('imported','duplicate','failed','dismissed') and (sender is not null or caption is not null);
  get diagnostics affected = row_count;
  -- Photothèque : seuls les médias archivés perdent leur message et leur expéditeur.
  update public.whatsapp_assets set sender=null, caption=null
  where library_status='archived' and status_changed_at < p_before and (sender is not null or caption is not null);
  get diagnostics archived = row_count;
  return affected + archived;
end $$;

-- 8. Droits : service_role uniquement, RLS sans politique.
alter table public.whatsapp_asset_uses enable row level security;
revoke all on public.whatsapp_asset_uses from public, anon, authenticated;
grant select, insert on public.whatsapp_asset_uses to service_role;
grant delete on public.whatsapp_senders to service_role;
revoke all on function public.whatsapp_claim(uuid), public.whatsapp_assign(uuid,uuid,text,text), public.whatsapp_forget_sender(text,text),
  public.whatsapp_purge_personal_data(timestamptz), public.codev_unread_notifications(text), codev_private.whatsapp_notification_event() from public, anon, authenticated;
grant execute on function public.whatsapp_claim(uuid), public.whatsapp_assign(uuid,uuid,text,text), public.whatsapp_forget_sender(text,text),
  public.whatsapp_purge_personal_data(timestamptz), public.codev_unread_notifications(text), codev_private.whatsapp_notification_event() to service_role;
notify pgrst, 'reload schema';
