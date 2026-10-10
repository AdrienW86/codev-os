-- Inbox persistante. Aucun contenu de conversation ni média binaire en base.
create table public.whatsapp_senders (
  sender text primary key check (sender ~ '^[1-9][0-9]{7,14}$'),
  client_id uuid not null references public.clients(id) on delete restrict,
  drive_folder_id text not null check (drive_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
  rights_confirmed boolean not null default false,
  enabled boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
create table public.whatsapp_inbox (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  phone_number_id text not null,
  message_id text not null,
  sender text not null check (sender ~ '^[1-9][0-9]{7,14}$'),
  media_id text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  received_at timestamptz not null,
  client_id uuid references public.clients(id) on delete restrict,
  drive_folder_id text,
  status text not null default 'pending' check (status in ('pending','processing','imported','duplicate','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  lease uuid,
  lease_until timestamptz,
  retry_at timestamptz not null default now(),
  error_code text,
  drive_file_id text,
  created_at timestamptz not null default now(),
  unique (waba_id, message_id),
  check ((client_id is null) = (drive_folder_id is null))
);
create index whatsapp_pending on public.whatsapp_inbox (retry_at, created_at) where status in ('pending','processing');
create table public.whatsapp_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  drive_folder_id text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  md5 text not null check (md5 ~ '^[a-f0-9]{32}$'),
  drive_file_id text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size integer not null check (size between 1 and 8388608),
  created_at timestamptz not null default now(),
  unique (client_id, drive_folder_id, sha256)
);
-- Un dossier est réservé à un seul client, même si plusieurs contacts alimentent ce dossier.
create function public.whatsapp_claim(p_lease uuid) returns setof public.whatsapp_inbox
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update public.whatsapp_inbox set status='failed', error_code='retry_exhausted', lease=null, lease_until=null
  where status='processing' and lease_until < now() and attempts=5;
  return query
  with candidate as (
    select i.id, coalesce(i.client_id,s.client_id) as client_id, coalesce(i.drive_folder_id,s.drive_folder_id) as folder
    from public.whatsapp_inbox i join public.whatsapp_senders s on s.sender=i.sender
    where s.enabled and s.rights_confirmed
      and (i.client_id is null or (i.client_id=s.client_id and i.drive_folder_id=s.drive_folder_id))
      and i.attempts < 5 and i.retry_at <= now()
      and (i.status='pending' or (i.status='processing' and i.lease_until < now()))
    order by i.created_at, i.id limit 1 for update of i skip locked
  )
  update public.whatsapp_inbox i set status='processing', client_id=c.client_id, drive_folder_id=c.folder,
    attempts=i.attempts+1, lease=p_lease, lease_until=now()+interval '5 minutes', error_code=null
  from candidate c where i.id=c.id returning i.*;
end $$;
create function public.whatsapp_sender_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  -- Serialize configuration writes to prevent concurrent cross-client folder assignments.
  perform pg_advisory_xact_lock(7420913);
  if exists(select 1 from public.publication_agent_projects where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.publication_drive_media where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.whatsapp_senders where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.whatsapp_assets where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.whatsapp_inbox where drive_folder_id=new.drive_folder_id and client_id<>new.client_id) then
    raise exception 'Folder already belongs to another client';
  end if;
  new.updated_at=now();
  return new;
end $$;
create trigger whatsapp_sender_guard before insert or update on public.whatsapp_senders for each row execute function public.whatsapp_sender_guard();
-- Empêche également une réattribution future du dossier Publications à un autre client.
create function public.whatsapp_publication_folder_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(7420913);
  if exists(select 1 from public.whatsapp_senders where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.whatsapp_assets where drive_folder_id=new.drive_folder_id and client_id<>new.client_id)
    or exists(select 1 from public.whatsapp_inbox where drive_folder_id=new.drive_folder_id and client_id<>new.client_id) then
    raise exception 'Folder already belongs to another client';
  end if;
  return new;
end $$;
create trigger whatsapp_publication_folder_guard before insert or update of drive_folder_id, client_id on public.publication_agent_projects for each row execute function public.whatsapp_publication_folder_guard();
revoke all on function public.whatsapp_publication_folder_guard() from public, anon, authenticated;
grant execute on function public.whatsapp_publication_folder_guard() to service_role;
-- Le périmètre attribué au premier traitement reste figé après un changement d'association.
create function public.whatsapp_scope_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if old.client_id is not null and (new.client_id is distinct from old.client_id or new.drive_folder_id is distinct from old.drive_folder_id) then
    raise exception 'Inbox scope is immutable';
  end if;
  return new;
end $$;
create trigger whatsapp_scope_guard before update on public.whatsapp_inbox for each row execute function public.whatsapp_scope_guard();
alter table public.whatsapp_senders enable row level security;
alter table public.whatsapp_inbox enable row level security;
alter table public.whatsapp_assets enable row level security;
revoke all on public.whatsapp_senders, public.whatsapp_inbox, public.whatsapp_assets from public, anon, authenticated;
grant select, insert, update on public.whatsapp_senders, public.whatsapp_inbox, public.whatsapp_assets to service_role;
revoke all on function public.whatsapp_claim(uuid), public.whatsapp_sender_guard(), public.whatsapp_scope_guard() from public, anon, authenticated;
grant execute on function public.whatsapp_claim(uuid), public.whatsapp_sender_guard(), public.whatsapp_scope_guard() to service_role;
notify pgrst, 'reload schema';
