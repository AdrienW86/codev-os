-- Budget IA centralisé (harness) : journal des appels IA des agents Blog, Visuels et Vidéo (passerelle mesurée),
-- et plafond mensuel par client. Les Publications (agent_runs) et la Photothèque (client_media_ai_usage) gardent
-- leur propre journal ; la dépense du mois les additionne. Aucune donnée de contenu, uniquement des compteurs.
create table public.ai_usage(
 id uuid primary key default gen_random_uuid(),
 agent text not null check(agent ~ '^[a-z][a-z-]{1,30}$'),
 client_id uuid references public.clients(id) on delete cascade,
 input_tokens integer not null check(input_tokens >= 0),
 output_tokens integer not null check(output_tokens >= 0),
 estimated_cost_eur numeric(10,6) not null check(estimated_cost_eur between 0 and 1),
 model text not null check(length(model) between 1 and 80),
 created_at timestamptz not null default now()
);
create index ai_usage_client_recent on public.ai_usage(client_id, created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant select, insert on public.ai_usage to service_role;

create table public.client_ai_budgets(
 client_id uuid primary key references public.clients(id) on delete cascade,
 monthly_cap_eur numeric(6,2) not null check(monthly_cap_eur between 0 and 200),
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 updated_at timestamptz not null default now()
);
alter table public.client_ai_budgets enable row level security;
revoke all on public.client_ai_budgets from public, anon, authenticated;
grant select, insert, update on public.client_ai_budgets to service_role;
