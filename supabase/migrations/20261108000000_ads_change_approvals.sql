-- Google Ads manual approvals: one-use, account-bound, expired by default after 15 minutes.
create table if not exists public.ads_change_approvals (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 account_id text not null check (account_id ~ '^[0-9]{10}$'),
 campaign_id text not null check (campaign_id ~ '^[0-9]+$'),
 actor_id text not null check (length(actor_id) between 1 and 256),
 operation_sha256 text not null check (operation_sha256 ~ '^[a-f0-9]{64}$'),
 operation_kind text not null check (operation_kind in ('campaign_pause','campaign_enable','keyword_add','keyword_pause','keyword_enable','negative_keyword_add')),
 status text not null default 'pending' check (status in ('pending','executing','succeeded','failed','uncertain','expired')),
 expires_at timestamptz not null default now() + interval '15 minutes',
 claimed_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 error_code text
);
create index if not exists ads_change_approvals_client_idx on public.ads_change_approvals(client_id,created_at desc);
alter table public.ads_change_approvals enable row level security;
revoke all on public.ads_change_approvals from public,anon,authenticated;
grant select,insert,update on public.ads_change_approvals to service_role;

-- A single conditional UPDATE serializes concurrent approvals. Never retry an uncertain mutation.
create or replace function public.codev_claim_ads_change(
 p_id uuid, p_client_id uuid, p_account_id text, p_campaign_id text,
 p_actor_id text, p_operation_sha256 text
) returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare claimed uuid;
begin
 update public.ads_change_approvals
 set status='executing', claimed_at=now()
 where id=p_id and client_id=p_client_id and account_id=p_account_id
 and campaign_id=p_campaign_id and actor_id=p_actor_id
 and operation_sha256=p_operation_sha256 and status='pending' and expires_at>now()
 returning id into claimed;
 return claimed is not null;
end $$;
revoke all on function public.codev_claim_ads_change(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.codev_claim_ads_change(uuid,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
