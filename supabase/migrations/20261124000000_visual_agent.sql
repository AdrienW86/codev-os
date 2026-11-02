-- Agent Visuels : génère, pour certains clients et à une fréquence donnée, des visuels à leur charte (logo, couleurs,
-- prestations vérifiées). Chaque visuel est déposé dans le dossier Drive du client : il suit ensuite le circuit
-- habituel (import, analyse, photothèque) et l'agent Publications le choisit comme n'importe quelle photo.
-- Additif : aucune table existante n'est modifiée.

create table public.client_visual_agents(
 client_id uuid primary key references public.clients(id) on delete cascade,
 enabled boolean not null default false,
 per_week smallint not null default 3 check(per_week between 1 and 14),
 primary_color text not null default '#1f2937' check(primary_color ~ '^#[0-9a-fA-F]{6}$'),
 secondary_color text not null default '#f59e0b' check(secondary_color ~ '^#[0-9a-fA-F]{6}$'),
 text_color text not null default '#ffffff' check(text_color ~ '^#[0-9a-fA-F]{6}$'),
 contact_line text check(contact_line is null or (length(btrim(contact_line)) between 2 and 80 and contact_line !~ '[\x00-\x1f]')),
 logo_path text check(logo_path is null or logo_path ~ '^[0-9a-f-]{36}/logo-[0-9a-f]{16}\.(png|jpg|webp)$'),
 last_generated_at timestamptz,
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.client_visual_agents enable row level security;

-- Journal des visuels générés : rotation des prestations, fréquence, et accroches déjà employées (jamais deux fois).
create table public.client_visual_items(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 service text not null check(length(btrim(service)) between 1 and 120),
 headline text not null check(length(btrim(headline)) between 2 and 90),
 subline text check(subline is null or length(subline) <= 140),
 template text not null check(template in('bandeau','diagonale','encadre','minimal')),
 drive_folder_id text not null check(length(drive_folder_id) between 10 and 200),
 drive_file_id text check(drive_file_id is null or length(drive_file_id) between 10 and 200),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 trigger text not null check(trigger in('scheduled','manual')),
 actor_id text check(actor_id is null or actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now()
);
create index client_visual_items_client_idx on public.client_visual_items(client_id,created_at desc);
alter table public.client_visual_items enable row level security;

revoke all on public.client_visual_agents, public.client_visual_items from public, anon, authenticated;
grant select, insert, update on public.client_visual_agents to service_role;
grant select, insert on public.client_visual_items to service_role;

-- Logos des clients : stockage privé (jamais public), lu par le serveur au moment du rendu.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('brand-assets','brand-assets',false,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
