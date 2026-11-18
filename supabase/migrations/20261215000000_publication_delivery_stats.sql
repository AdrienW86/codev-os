-- Architecture des agents, lot 3 : statistiques des publications diffusées, par réseau.
-- Aucune donnée existante n'est modifiée. Sans cette migration, aucun relevé n'est fait (comportement d'avant).
--
-- publication_delivery_stats : dernier relevé des interactions d'une diffusion publiée (lecture seule chez le réseau).
--   status ok : chiffres relevés ; unsupported : le réseau (ou l'autorisation accordée) ne fournit pas de statistiques
--   pour ce post ; error : relevé impossible cette fois (code court, jamais le texte du fournisseur).
create table if not exists public.publication_delivery_stats (
  delivery_id uuid primary key references public.publication_deliveries(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','google_business_profile','tiktok','snapchat')),
  status text not null check (status in ('ok','unsupported','error')),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  fetch_count integer not null default 1 check (fetch_count between 1 and 1000),
  fetched_at timestamptz not null default now()
);
create index if not exists publication_delivery_stats_client_idx on public.publication_delivery_stats (client_id, fetched_at desc);

alter table public.publication_delivery_stats enable row level security;
revoke all on public.publication_delivery_stats from public, anon, authenticated;
grant select, insert, update on public.publication_delivery_stats to service_role;
