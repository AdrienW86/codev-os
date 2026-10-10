create table public.client_ads_context (
  client_id uuid primary key references public.clients(id) on delete cascade,
  context jsonb not null check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 16384),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
create table public.ads_analysis_leases (
  client_id uuid primary key references public.clients(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null,
  next_allowed_at timestamptz not null
);
alter table public.client_ads_context enable row level security;
alter table public.ads_analysis_leases enable row level security;
revoke all on public.client_ads_context, public.ads_analysis_leases from public, anon, authenticated;
grant select, insert, update, delete on public.client_ads_context, public.ads_analysis_leases to service_role;

create function public.codev_save_ads_context(p_client_id uuid, p_context jsonb, p_revision integer) returns integer
language plpgsql security invoker set search_path = pg_catalog as $$
declare result integer;
begin
  if p_revision is null or p_revision < 0 then raise exception 'Invalid revision' using errcode='22023'; end if;
  if p_revision = 0 then
    insert into public.client_ads_context(client_id,context) values(p_client_id,p_context) on conflict do nothing returning revision into result;
  else
    update public.client_ads_context set context=p_context, revision=revision+1, updated_at=now()
      where client_id=p_client_id and revision=p_revision returning revision into result;
  end if;
  if result is null then raise exception 'Context changed' using errcode='40001'; end if;
  return result;
end $$;
create function public.codev_claim_ads_analysis(p_client_id uuid, p_token uuid) returns boolean
language plpgsql security invoker set search_path = pg_catalog as $$
declare claimed uuid;
begin
  insert into public.ads_analysis_leases(client_id,token,expires_at,next_allowed_at)
    values(p_client_id,p_token,now()+interval '120 seconds',now()+interval '60 seconds')
    on conflict(client_id) do update set token=excluded.token, expires_at=excluded.expires_at, next_allowed_at=excluded.next_allowed_at
      where public.ads_analysis_leases.expires_at <= now() and public.ads_analysis_leases.next_allowed_at <= now()
    returning token into claimed;
  return claimed is not null;
end $$;
revoke all on function public.codev_save_ads_context(uuid,jsonb,integer), public.codev_claim_ads_analysis(uuid,uuid) from public,anon,authenticated;
grant execute on function public.codev_save_ads_context(uuid,jsonb,integer), public.codev_claim_ads_analysis(uuid,uuid) to service_role;
notify pgrst,'reload schema';
