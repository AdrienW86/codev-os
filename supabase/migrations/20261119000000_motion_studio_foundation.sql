-- Studio Motion D0 : briefs enregistrés, ressources Drive existantes, aucun rendu ni publication.
-- Migration additive. À appliquer seulement après CI verte et revue humaine.
create table if not exists public.motion_projects (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete restrict,
 source_folder_id text not null check (source_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
 title text not null check (char_length(title) between 5 and 160),
 brief text not null check (char_length(brief) between 20 and 6000),
 brand_direction text not null default '' check (char_length(brand_direction) <= 4000),
 duration_seconds integer not null check (duration_seconds between 5 and 90),
 aspect_ratio text not null check (aspect_ratio in ('9:16','16:9','1:1')),
 engine text not null check (engine in ('remotion','freeform')),
 voice_mode text not null check (voice_mode in ('none','elevenlabs')),
 status text not null default 'draft' check (status = 'draft'),
 created_by text not null check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now()
);

create table if not exists public.motion_events (
 id uuid primary key default gen_random_uuid(),
 motion_project_id uuid not null references public.motion_projects(id) on delete cascade,
 actor_id text not null check (actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 action text not null check (action = 'motion.created'),
 created_at timestamptz not null default now()
);

create index if not exists motion_projects_client_created on public.motion_projects(client_id,created_at desc);
create index if not exists motion_events_project_created on public.motion_events(motion_project_id,created_at);

alter table public.motion_projects enable row level security;
alter table public.motion_events enable row level security;
revoke all on public.motion_projects, public.motion_events from public, anon, authenticated;
grant select, insert on public.motion_projects, public.motion_events to service_role;

-- Écriture ET historique dans une transaction ; le dossier doit appartenir au client,
-- être déjà configuré dans les intégrations et avoir ses droits confirmés.
create or replace function public.motion_project_create(
 p_client_id uuid, p_source_folder_id text, p_title text, p_brief text,
 p_brand_direction text, p_duration_seconds integer, p_aspect_ratio text,
 p_engine text, p_voice_mode text, p_actor_id text
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare v_id uuid;
begin
 if p_client_id is null
  or coalesce(p_actor_id,'') !~ '^user_[a-zA-Z0-9_-]{1,200}$'
  or coalesce(p_source_folder_id,'') !~ '^[a-zA-Z0-9_-]{10,200}$'
  or char_length(coalesce(p_title,'')) not between 5 and 160
  or char_length(coalesce(p_brief,'')) not between 20 and 6000
  or char_length(coalesce(p_brand_direction,'')) > 4000
  or p_duration_seconds not between 5 and 90
  or coalesce(p_aspect_ratio,'') not in ('9:16','16:9','1:1')
  or coalesce(p_engine,'') not in ('remotion','freeform')
  or coalesce(p_voice_mode,'') not in ('none','elevenlabs') then
  raise exception 'Invalid motion project' using errcode = '22023';
 end if;
 if not exists (
    select 1 from public.publication_agent_projects p
      where p.client_id = p_client_id and p.drive_folder_id = p_source_folder_id
        and p.rights_confirmed = true
  ) and not exists (
    select 1 from public.whatsapp_senders s
      where s.client_id = p_client_id and s.drive_folder_id = p_source_folder_id
        and s.rights_confirmed = true and s.enabled = true
  ) then
   raise exception 'Drive source not authorized for client' using errcode = '42501';
 end if;
 insert into public.motion_projects(
   client_id,source_folder_id,title,brief,brand_direction,
   duration_seconds,aspect_ratio,engine,voice_mode,created_by
 ) values (
   p_client_id,p_source_folder_id,p_title,p_brief,p_brand_direction,
   p_duration_seconds,p_aspect_ratio,p_engine,p_voice_mode,p_actor_id
 ) returning id into v_id;
 insert into public.motion_events(motion_project_id,actor_id,action)
 values(v_id,p_actor_id,'motion.created');
 return v_id;
end $$;
revoke all on function public.motion_project_create(uuid,text,text,text,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.motion_project_create(uuid,text,text,text,text,integer,text,text,text,text) to service_role;
