-- Audits Lighthouse de CODE-V OS. Jamais exposés aux rôles clients / publics.
create table if not exists public.performance_audits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  url text not null check (char_length(url) between 1 and 1600),
  strategy text not null check (strategy in ('mobile', 'desktop')),
  source text not null default 'PageSpeed Insights / Lighthouse',
  scores jsonb not null,
  lab jsonb not null,
  field jsonb not null,
  opportunities jsonb not null default '[]'::jsonb,
  analyzed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists performance_audits_client_time_idx on public.performance_audits (client_id, analyzed_at desc);
create index if not exists performance_audits_created_idx on public.performance_audits (created_at desc);
alter table public.performance_audits enable row level security;
revoke all on public.performance_audits from anon, authenticated;
grant select, insert, update, delete on public.performance_audits to service_role;
-- Aucun accès RLS anon/authenticated ; seul le backend contrôlé par requireAdmin écrit.
