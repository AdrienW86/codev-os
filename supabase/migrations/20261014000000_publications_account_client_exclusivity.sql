-- Lot 4.3 P13 — One external publication account (Facebook Page, Instagram professional account, Google location)
-- serves ONE client only. Additive, forward-only; functions replaced with the same signatures and grants.
-- Why: a single administrator Meta / Google login sees every Page / location they manage, so the P9 sync lists the
-- same external account under every client connected with that login. Listing is harmless; ASSIGNING the same
-- external account to channels of two different clients would publish one client's content on another client's
-- Page. From now on:
--  * an account is assignable only if no channel of ANOTHER client uses the same platform + external id;
--  * assignments of the same external account are serialized (advisory lock) — two concurrent assignments for two
--    clients cannot both succeed;
--  * a channel whose external account is (still) used by another client is not publishable ('account_shared'),
--    so the delivery engine blocks it before any provider call;
--  * the accounts list tells the admin which accounts are already used by another client.

create function publications_private.account_used_by_other_client(p_account_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select exists(
   select 1 from public.publication_accounts o join public.publication_project_channels ch on ch.publication_account_id=o.id
   where o.platform=a.platform and o.external_account_id=a.external_account_id and o.client_id<>a.client_id)
  from public.publication_accounts a where a.id=p_account_id),false);
$$;

create or replace function publications_private.account_assignable(p_account_id uuid,p_client_id uuid,p_platform text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select a.client_id=p_client_id and a.platform=p_platform and a.connection_id is not null and a.status='active' and a.enabled
   and c.status='active' and c.credential_reference is not null and (c.expires_at is null or c.expires_at>now())
   and publications_private.connection_provider_platform(c.provider,a.platform)
   and not publications_private.account_used_by_other_client(a.id)
  from public.publication_accounts a join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id where a.id=p_account_id),false);
$$;

create or replace function public.publication_channel_assign_account(p_project_id uuid,p_platform text,p_account_id uuid,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare ch public.publication_project_channels;acc public.publication_accounts;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_project_id is null or p_platform not in('facebook','instagram','google_business_profile') then
  raise exception 'Invalid assignment' using errcode='22023'; end if;
 select * into ch from public.publication_project_channels where project_id=p_project_id and platform=p_platform for update;
 if not found then raise exception 'Channel not configured' using errcode='23514'; end if;
 if p_account_id is not null then
  select * into acc from public.publication_accounts where id=p_account_id;
  -- Serializes every assignment of this external account, whatever the client (checked again after the lock).
  if acc.id is not null then perform pg_advisory_xact_lock(hashtextextended('codev.publication_account:'||acc.platform||':'||acc.external_account_id,0)); end if;
  if not publications_private.account_assignable(p_account_id,ch.client_id,ch.platform) then
   if acc.id is not null and publications_private.account_used_by_other_client(p_account_id) then raise exception 'Account already used by another client' using errcode='23505'; end if;
   raise exception 'Account not assignable to this channel' using errcode='23514'; end if;
 end if;
 if ch.publication_account_id is not distinct from p_account_id then return ch.id; end if;
 update public.publication_project_channels set publication_account_id=p_account_id where id=ch.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.channel_account_assigned',ch.client_id,'project_channel',ch.id,
  jsonb_build_object('client_id',ch.client_id,'project_id',ch.project_id,'platform',ch.platform,'account_id',p_account_id,'previous_account_id',ch.publication_account_id));
 return ch.id;
end $$;

create or replace function publications_private.channel_publishability(p_channel_id uuid) returns text
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select case
   when s.emergency_stop then 'emergency_stop'
   when not s.publishing_enabled or not coalesce(cs.publishing_enabled,false) then 'publishing_disabled'
   when not ch.enabled then 'channel_disabled'
   when ch.publication_account_id is null then 'no_account'
   when c.id is null or c.status<>'active' or c.credential_reference is null or (c.expires_at is not null and c.expires_at<=now())
    or not publications_private.connection_provider_platform(c.provider,ch.platform) then 'connection_inactive'
   when a.status<>'active' or not a.enabled or a.client_id<>ch.client_id or a.platform<>ch.platform then 'account_inactive'
   when publications_private.account_used_by_other_client(a.id) then 'account_shared'
   else 'publishable' end
  from public.publication_project_channels ch
  cross join (select * from public.publication_settings limit 1) s
  left join public.publication_client_settings cs on cs.client_id=ch.client_id
  left join public.publication_accounts a on a.id=ch.publication_account_id
  left join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id
  where ch.id=p_channel_id),'channel_disabled');
$$;

create or replace function public.publication_accounts_available(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'platform',a.platform,'display_name',a.display_name,'status',a.status,'enabled',a.enabled,
   'connection_status',c.status,'assignable',publications_private.account_assignable(a.id,a.client_id,a.platform),
   'used_by_other_client',publications_private.account_used_by_other_client(a.id)) order by a.platform,a.display_name,a.id),'[]'::jsonb)
 from public.publication_accounts a join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id
 where a.client_id=p_client_id;
$$;

revoke all on function publications_private.account_used_by_other_client(uuid) from public,anon,authenticated,service_role;
grant execute on function publications_private.account_used_by_other_client(uuid) to service_role;
revoke all on function publications_private.account_assignable(uuid,uuid,text),publications_private.channel_publishability(uuid) from public,anon,authenticated;
grant execute on function publications_private.account_assignable(uuid,uuid,text),publications_private.channel_publishability(uuid) to service_role;
revoke all on function public.publication_channel_assign_account(uuid,text,uuid,text),public.publication_accounts_available(uuid) from public,anon,authenticated;
grant execute on function public.publication_channel_assign_account(uuid,text,uuid,text),public.publication_accounts_available(uuid) to service_role;
