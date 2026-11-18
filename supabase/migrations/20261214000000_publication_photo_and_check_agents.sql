-- Publications découpées (architecture harness, lot 4) : Agent Photo et Agent Contrôle.
-- Aucune donnée existante n'est modifiée. Sans cette migration, les deux agents restent inactifs (comportement d'avant).
--
-- publication_generated_images : image proposée par l'Agent Photo quand une préparation n'a aucune photo. Elle n'est
--   JAMAIS attachée sans la validation explicite d'un administrateur (statut approved, décideur user_…).
-- publication_coherence_checks : verdict de l'Agent Contrôle (cohérence texte / image) par révision, relu par la
--   validation automatique pour ne pas rappeler l'IA à chaque passage.

create table if not exists public.publication_generated_images (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.publication_agent_v2_runs(id) on delete cascade,
  publication_ids uuid[] not null check (cardinality(publication_ids) between 1 and 5),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','attach_failed','skipped')),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  storage_path text check (storage_path is null or char_length(storage_path) between 10 and 400),
  model text not null check (char_length(model) between 1 and 100),
  estimated_cost_eur numeric(10,4) not null default 0 check (estimated_cost_eur >= 0),
  decided_by text check (decided_by is null or decided_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  decided_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at timestamptz not null default now(),
  -- Décision humaine obligatoire pour valider, refuser ou tenter l'attache ; « skipped » = l'agent a renoncé (illustration impossible).
  check ((status in ('approved','rejected','attach_failed')) = (decided_by is not null)),
  check (status = 'skipped' or storage_path is not null)
);
create index if not exists publication_generated_images_status_idx on public.publication_generated_images (status, created_at desc);
create index if not exists publication_generated_images_run_idx on public.publication_generated_images (run_id);
-- Une seule proposition en attente par préparation.
create unique index if not exists publication_generated_images_one_pending on public.publication_generated_images (run_id) where status = 'pending_review';

create table if not exists public.publication_coherence_checks (
  revision_id uuid primary key references public.publication_revisions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  coherent boolean not null,
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  model text,
  checked_at timestamptz not null default now()
);
create index if not exists publication_coherence_checks_client_idx on public.publication_coherence_checks (client_id, checked_at desc);

alter table public.publication_generated_images enable row level security;
alter table public.publication_coherence_checks enable row level security;
revoke all on public.publication_generated_images, public.publication_coherence_checks from public, anon, authenticated;
grant select, insert, update on public.publication_generated_images to service_role;
grant select, insert, update on public.publication_coherence_checks to service_role;

-- Images générées : stockage privé, lu par le serveur (aperçu signé, attache après validation).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('publication-generated','publication-generated',false,8388608,array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Notification « Image générée à valider » vers la page de validation des images.
alter table public.admin_notifications drop constraint admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
  check (href ~ '^/(reports|advertising/analyses|agents|publications|blog)/[0-9a-f-]{36}$' or href='/work?kind=incident' or href='/publications/review'
    or href ~ '^/clients/[0-9a-f-]{36}\?tab=media$' or href='/settings/whatsapp' or href='/notifications' or href='/publications/images');
