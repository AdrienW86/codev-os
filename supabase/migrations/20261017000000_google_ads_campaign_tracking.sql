-- Créée avec la CLI puis ordonnée après les migrations existantes (dont 20261016).
-- Aucun compte ni campagne Google Ads n'est modifié. Accès service_role uniquement.
alter table public.client_connections add constraint client_connections_ads_scope_key
  unique (id, client_id, provider, external_account_id);

create table public.client_ads_scopes (
  client_id uuid primary key references public.clients(id) on delete cascade,
  connection_id uuid not null,
  provider text not null default 'google_ads' check (provider = 'google_ads'),
  account_id text not null check (account_id ~ '^[0-9]{10}$'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  unique (client_id, account_id),
  foreign key (connection_id, client_id, provider, account_id)
    references public.client_connections(id, client_id, provider, external_account_id)
);
create index client_ads_scopes_connection_idx on public.client_ads_scopes(connection_id);

create table public.client_ads_campaigns (
  account_id text not null,
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,20}$'),
  client_id uuid not null,
  primary key (account_id, campaign_id),
  foreign key (client_id, account_id) references public.client_ads_scopes(client_id, account_id) on delete cascade
);
create index client_ads_campaigns_client_idx on public.client_ads_campaigns(client_id, account_id);

alter table public.client_ads_scopes enable row level security;
alter table public.client_ads_campaigns enable row level security;
revoke all on public.client_ads_scopes, public.client_ads_campaigns from public, anon, authenticated;
grant select, insert, update, delete on public.client_ads_scopes, public.client_ads_campaigns to service_role;

create function public.codev_set_ads_campaigns(p_client_id uuid, p_connection_id uuid, p_account_id text, p_campaign_ids text[], p_revision integer)
returns integer language plpgsql security invoker set search_path = pg_catalog as $$
declare current_revision integer;
begin
  if p_campaign_ids is null or cardinality(p_campaign_ids) > 50
    or exists(select 1 from unnest(p_campaign_ids) id where id is null or id !~ '^[0-9]{1,20}$')
    or cardinality(p_campaign_ids) <> (select count(distinct id) from unnest(p_campaign_ids) id)
    or p_revision is null or p_revision < 0 then
    raise exception 'Invalid campaign selection' using errcode = '22023';
  end if;
  -- Les appels sur un même compte sont sérialisés, y compris entre deux clients.
  perform pg_advisory_xact_lock(hashtextextended('codev_ads:' || p_account_id, 0));
  perform 1 from public.client_connections where id = p_connection_id and client_id = p_client_id
    and provider = 'google_ads' and external_account_id = p_account_id and status = 'connected' for update;
  if not found then raise exception 'Account association changed' using errcode = '55000'; end if;
  select revision into current_revision from public.client_ads_scopes where client_id = p_client_id for update;
  if coalesce(current_revision, 0) <> p_revision then raise exception 'Selection changed' using errcode = '40001'; end if;
  if exists(select 1 from public.client_ads_campaigns where account_id = p_account_id
      and campaign_id = any(p_campaign_ids) and client_id <> p_client_id) then
    raise exception 'Campaign already assigned to another client' using errcode = '23505';
  end if;
  insert into public.client_ads_scopes(client_id, connection_id, account_id, revision)
    values(p_client_id, p_connection_id, p_account_id, 1)
    on conflict(client_id) do update set revision = public.client_ads_scopes.revision + 1, updated_at = now();
  delete from public.client_ads_campaigns where client_id = p_client_id;
  insert into public.client_ads_campaigns(account_id, campaign_id, client_id)
    select p_account_id, id, p_client_id from unnest(p_campaign_ids) id;
  return coalesce(current_revision, 0) + 1;
end $$;
revoke all on function public.codev_set_ads_campaigns(uuid, uuid, text, text[], integer) from public, anon, authenticated;
grant execute on function public.codev_set_ads_campaigns(uuid, uuid, text, text[], integer) to service_role;
notify pgrst, 'reload schema';
