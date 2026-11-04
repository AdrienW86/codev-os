-- Agent Vidéo : pour les clients qui l'activent, une vidéo motion design est générée à la fréquence choisie à partir de
-- leurs photos publiables et de leurs prestations vérifiées (script IA contrôlé, musique de la bibliothèque), puis rangée
-- dans le Studio vidéo du client. Rien n'est publié : la publication TikTok ou Snapchat reste une action explicite.
create table public.client_video_agents(
 client_id uuid primary key references public.clients(id) on delete cascade,
 enabled boolean not null default false,
 per_week smallint not null default 1 check(per_week between 1 and 7),
 pace text not null default 'standard' check(pace in('dynamic','standard','calm')),
 music text not null default 'auto' check(music ~ '^[a-z-]{2,40}$'),
 last_generated_at timestamptz,
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.client_video_agents enable row level security;
revoke all on public.client_video_agents from public, anon, authenticated;
grant select, insert, update on public.client_video_agents to service_role;

-- Les vidéos de l'agent sont créées par « video_agent » (une vidéo du Studio reste créée par un administrateur).
alter table public.studio_videos drop constraint if exists studio_videos_created_by_check;
alter table public.studio_videos add constraint studio_videos_created_by_check check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$' or created_by='video_agent');
