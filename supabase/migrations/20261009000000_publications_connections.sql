-- Lot 4.3 P9 — Publication connections, credential references and external accounts. Nothing is published.
-- Model: CLIENT → client_connections (provider meta | google_business_profile) → publication_accounts (facebook /
-- instagram pages, GBP locations) → publication_project_channels.publication_account_id.
-- Secrets never reach these tables: client_connections.credential_reference is an opaque vault reference
-- (vault:connection/<random uuid>); accounts synced from a connection carry no credential at all.
-- client_connections is reused (Google Ads keeps its rows and behaviour): every P9 rule is scoped to the two
-- publication providers. Forward-only and additive; legacy publication_accounts rows stay valid.

-- 1. Helpers.
create function publications_private.connection_provider(p_provider text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(p_provider in('meta','google_business_profile'),false);
$$;
-- Meta exposes Facebook pages and Instagram business accounts; GBP exposes locations.
create function publications_private.connection_provider_platform(p_provider text,p_platform text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce((p_provider='meta' and p_platform in('facebook','instagram')) or (p_provider='google_business_profile' and p_platform='google_business_profile'),false);
$$;
-- Opaque reference only: fixed prefix + random UUID. No secret, token, URL or serialized JSON can match.
create function publications_private.valid_credential_reference(p_reference text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(p_reference ~ '^vault:connection/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false);
$$;
-- Writes on publication connections / connection-backed accounts are allowed only inside the P9 RPCs.
create function publications_private.connection_write_allowed() returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(current_setting('codev.publication_connections',true)='rpc',false);
$$;

-- 2. client_connections: additive columns, rules scoped to the publication providers.
alter table public.client_connections
 add column credential_reference text,
 add column connected_at timestamptz,
 add column expires_at timestamptz,
 add constraint client_connections_id_client_key unique(id,client_id),
 add constraint client_connections_id_client_provider_key unique(id,client_id,provider),
 add constraint client_connections_credential_reference_check check(credential_reference is null or publications_private.valid_credential_reference(credential_reference)),
 add constraint client_connections_publication_status_check check(not publications_private.connection_provider(provider)
  or (status in('pending','active','expired','revoked','error','disabled')
   and publications_private.safe_metadata(metadata)
   and (status<>'active' or (credential_reference is not null and connected_at is not null))
   and (status<>'disabled' or credential_reference is null)
   and (external_account_id is null or (length(external_account_id) between 1 and 300 and external_account_id !~ '(://|[\s{}"])'))));

create function publications_private.guard_publication_connection() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
  if publications_private.connection_provider(old.provider) then raise exception 'Publication connections are never deleted' using errcode='55000'; end if;
  return old; end if;
 if publications_private.connection_provider(new.provider) or (tg_op='UPDATE' and publications_private.connection_provider(old.provider)) then
  if not publications_private.connection_write_allowed() then raise exception 'Publication connections change only through their RPCs' using errcode='55000'; end if;
  if tg_op='UPDATE' and (new.id,new.client_id,new.provider,new.created_at) is distinct from (old.id,old.client_id,old.provider,old.created_at) then
   raise exception 'Connection identity is immutable' using errcode='55000'; end if;
 end if;
 return new;
end $$;
create trigger publication_connection_guard before insert or update or delete on public.client_connections
 for each row execute function publications_private.guard_publication_connection();
create trigger publication_connection_no_truncate before truncate on public.client_connections
 for each statement execute function publications_private.prevent_history_change();

-- 3. publication_accounts: connection-backed accounts (P9) next to legacy rows (unchanged).
alter table public.publication_accounts
 add column connection_id uuid,
 add column display_name text check(display_name is null or (length(btrim(display_name)) between 1 and 200 and display_name !~ '[\x00-\x1f]')),
 add column parent_external_id text check(parent_external_id is null or (length(parent_external_id) between 1 and 300 and parent_external_id !~ '(://|[\s{}"])')),
 add column last_synced_at timestamptz,
 add constraint publication_accounts_connection_fk foreign key(connection_id,client_id) references public.client_connections(id,client_id) on delete restrict;
-- Widen the two historical checks (status vocabulary, enabled rule) to accept connection-backed accounts.
do $$declare c record;dropped integer:=0;begin
 for c in select conname from pg_constraint where conrelid='public.publication_accounts'::regclass and contype='c'
   and (pg_get_constraintdef(oid) like '%status = ANY%' or pg_get_constraintdef(oid) like '%NOT enabled%') loop
  execute format('alter table public.publication_accounts drop constraint %I',c.conname);dropped:=dropped+1;
 end loop;
 if dropped<>2 then raise exception 'Unexpected publication_accounts checks: %',dropped; end if;
end $$;
alter table public.publication_accounts
 add constraint publication_accounts_status_check check(case when connection_id is null then status in('disconnected','connected','error','revoked')
  else status in('active','unavailable','revoked','disabled') end),
 add constraint publication_accounts_enabled_check check(not enabled or (connection_id is null and status='connected' and external_account_id is not null and credential_reference is not null)
  or (connection_id is not null and status='active' and external_account_id is not null)),
 add constraint publication_accounts_connection_credential_check check(connection_id is null or credential_reference is null),
 add constraint publication_accounts_connection_identity_check check(connection_id is null or (external_account_id is not null and display_name is not null
  and external_account_id !~ '(://|[\s{}"])'));
create index publication_accounts_connection_idx on public.publication_accounts(connection_id) where connection_id is not null;

create function publications_private.guard_publication_account() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'Publication accounts are never deleted' using errcode='55000'; end if;
 if (new.connection_id is not null or (tg_op='UPDATE' and old.connection_id is not null)) and not publications_private.connection_write_allowed() then
  raise exception 'Connection accounts change only through their RPCs' using errcode='55000'; end if;
 if tg_op='UPDATE' and (new.id,new.client_id,new.platform,new.created_at) is distinct from (old.id,old.client_id,old.platform,old.created_at) then
  raise exception 'Account identity is immutable' using errcode='55000'; end if;
 if tg_op='UPDATE' and old.connection_id is not null and (new.connection_id,new.external_account_id) is distinct from (old.connection_id,old.external_account_id) then
  raise exception 'Account identity is immutable' using errcode='55000'; end if;
 if new.connection_id is not null and not exists(select 1 from public.client_connections c where c.id=new.connection_id and c.client_id=new.client_id
   and publications_private.connection_provider_platform(c.provider,new.platform)) then
  raise exception 'Account platform does not match its connection' using errcode='23514'; end if;
 return new;
end $$;
create trigger publication_account_guard before insert or update or delete on public.publication_accounts
 for each row execute function publications_private.guard_publication_account();
create trigger publication_account_no_truncate before truncate on public.publication_accounts
 for each statement execute function publications_private.prevent_history_change();

-- 4. Channel ↔ account: a newly assigned account must be usable (same client and platform, connection-backed,
-- active and enabled, active connection of the matching provider). Existing links are never re-checked.
create function publications_private.account_assignable(p_account_id uuid,p_client_id uuid,p_platform text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select a.client_id=p_client_id and a.platform=p_platform and a.connection_id is not null and a.status='active' and a.enabled
   and c.status='active' and c.credential_reference is not null and (c.expires_at is null or c.expires_at>now())
   and publications_private.connection_provider_platform(c.provider,a.platform)
  from public.publication_accounts a join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id where a.id=p_account_id),false);
$$;
create function publications_private.guard_channel_account() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if new.publication_account_id is not null and (tg_op='INSERT' or new.publication_account_id is distinct from old.publication_account_id)
  and not publications_private.account_assignable(new.publication_account_id,new.client_id,new.platform) then
  raise exception 'Account not assignable to this channel' using errcode='23514'; end if;
 return new;
end $$;
create trigger project_channel_account_guard before insert or update of publication_account_id on public.publication_project_channels
 for each row execute function publications_private.guard_channel_account();

-- 5. Publishability of a channel (used by the future publisher, P10). Fail closed, most global reason first.
create function publications_private.channel_publishability(p_channel_id uuid) returns text
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select case
   when s.emergency_stop then 'emergency_stop'
   when not s.publishing_enabled or not coalesce(cs.publishing_enabled,false) then 'publishing_disabled'
   when not ch.enabled then 'channel_disabled'
   when ch.publication_account_id is null then 'no_account'
   when c.id is null or c.status<>'active' or c.credential_reference is null or (c.expires_at is not null and c.expires_at<=now())
    or not publications_private.connection_provider_platform(c.provider,ch.platform) then 'connection_inactive'
   when a.status<>'active' or not a.enabled or a.client_id<>ch.client_id or a.platform<>ch.platform then 'account_inactive'
   else 'publishable' end
  from public.publication_project_channels ch
  cross join (select * from public.publication_settings limit 1) s
  left join public.publication_client_settings cs on cs.client_id=ch.client_id
  left join public.publication_accounts a on a.id=ch.publication_account_id
  left join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id
  where ch.id=p_channel_id),'channel_disabled');
$$;

-- 6. RPCs. Every write sets the session flag, every RPC audits without secret, token or reference.
-- Registration after a successful OAuth exchange (future): the secret is already in the vault, only its opaque
-- reference arrives here. Returns the replaced reference (server only) so the vault can drop it.
create function public.publication_connection_register(p_client_id uuid,p_provider text,p_credential_reference text,p_external_identity text,
 p_expires_at timestamptz,p_metadata jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare old public.client_connections;saved public.client_connections;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or not publications_private.connection_provider(p_provider)
  or not publications_private.valid_credential_reference(p_credential_reference) or not publications_private.safe_metadata(coalesce(p_metadata,'{}'::jsonb))
  or (p_external_identity is not null and (length(p_external_identity) not between 1 and 300 or p_external_identity ~ '(://|[\s{}"])')) then
  raise exception 'Invalid connection' using errcode='22023'; end if;
 if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Invalid client' using errcode='23514'; end if;
 perform set_config('codev.publication_connections','rpc',true);
 select * into old from public.client_connections where client_id=p_client_id and provider=p_provider for update;
 if found then
  update public.client_connections set status='active',credential_reference=p_credential_reference,external_account_id=p_external_identity,metadata=coalesce(p_metadata,'{}'::jsonb),
   connected_at=now(),expires_at=p_expires_at,last_checked_at=now() where id=old.id returning * into saved;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.connection_status_changed',p_client_id,'client_connection',saved.id,
   jsonb_build_object('client_id',p_client_id,'connection_id',saved.id,'provider',p_provider,'from',old.status,'to','active'));
 else
  insert into public.client_connections(client_id,provider,status,credential_reference,external_account_id,metadata,connected_at,expires_at,last_checked_at)
  values(p_client_id,p_provider,'active',p_credential_reference,p_external_identity,coalesce(p_metadata,'{}'::jsonb),now(),p_expires_at,now()) returning * into saved;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.connection_created',p_client_id,'client_connection',saved.id,
   jsonb_build_object('client_id',p_client_id,'connection_id',saved.id,'provider',p_provider));
 end if;
 perform set_config('codev.publication_connections','',true);
 return jsonb_build_object('connection_id',saved.id,'created',old.id is null,
  'replaced_reference',case when old.credential_reference is distinct from p_credential_reference then old.credential_reference end);
end $$;

-- Status detected by a validation / refresh (future, explicit). active again only with a credential (refresh).
-- revoked: every active or unavailable account of the connection becomes revoked (admin-disabled ones stay disabled).
create function public.publication_connection_set_status(p_connection_id uuid,p_status text,p_credential_reference text,p_expires_at timestamptz,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.client_connections;reference text;accounts integer:=0;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_connection_id is null or p_status not in('active','expired','revoked','error')
  or (p_credential_reference is not null and not publications_private.valid_credential_reference(p_credential_reference)) then
  raise exception 'Invalid connection status' using errcode='22023'; end if;
 select * into c from public.client_connections where id=p_connection_id for update;
 if not found or not publications_private.connection_provider(c.provider) then raise exception 'Invalid connection' using errcode='23514'; end if;
 if c.status='disabled' then raise exception 'Connection disconnected' using errcode='55000'; end if;
 reference:=coalesce(p_credential_reference,c.credential_reference);
 if p_status='active' and reference is null then raise exception 'Credential required' using errcode='23514'; end if;
 perform set_config('codev.publication_connections','rpc',true);
 update public.client_connections set status=p_status,credential_reference=reference,expires_at=case when p_status='active' then p_expires_at else expires_at end,
  connected_at=coalesce(connected_at,now()),last_checked_at=now() where id=c.id;
 if p_status='revoked' then
  update public.publication_accounts set status='revoked',enabled=false where connection_id=c.id and status in('active','unavailable');get diagnostics accounts=row_count;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.connection_status_changed',c.client_id,'client_connection',c.id,
  jsonb_build_object('client_id',c.client_id,'connection_id',c.id,'provider',c.provider,'from',c.status,'to',p_status,'accounts_revoked',accounts));
 perform set_config('codev.publication_connections','',true);
 return jsonb_build_object('connection_id',c.id,'status',p_status,'replaced_reference',case when reference is distinct from c.credential_reference then c.credential_reference end);
end $$;

-- Atomic sync of the accounts exposed by a connection: upsert, accounts absent from the provider become
-- unavailable (never deleted), admin-disabled accounts stay disabled. Never touches any credential.
create function public.publication_accounts_sync(p_client_id uuid,p_connection_id uuid,p_accounts jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.client_connections;item jsonb;existing public.publication_accounts;seen uuid[]:=array[]::uuid[];keys text[]:=array[]::text[];key text;
 inserted integer:=0;updated integer:=0;unavailable integer:=0;saved uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or p_connection_id is null
  or jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts)>500 then raise exception 'Invalid accounts' using errcode='22023'; end if;
 select * into c from public.client_connections where id=p_connection_id for update;
 if not found or c.client_id<>p_client_id or not publications_private.connection_provider(c.provider) then raise exception 'Connection outside the client' using errcode='23514'; end if;
 if c.status<>'active' or c.credential_reference is null then raise exception 'Connection inactive' using errcode='55000'; end if;
 for item in select value from jsonb_array_elements(p_accounts) loop
  if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k)
    is distinct from array['display_name','external_account_id','metadata','parent_external_id','platform']
   or jsonb_typeof(item->'platform') is distinct from 'string' or jsonb_typeof(item->'external_account_id') is distinct from 'string'
   or jsonb_typeof(item->'display_name') is distinct from 'string' or jsonb_typeof(item->'parent_external_id') not in('string','null')
   or not publications_private.safe_metadata(item->'metadata') then raise exception 'Invalid accounts' using errcode='22023'; end if;
  if not publications_private.connection_provider_platform(c.provider,item->>'platform') then raise exception 'Platform does not match the provider' using errcode='23514'; end if;
  key:=(item->>'platform')||'|'||(item->>'external_account_id');
  if key=any(keys) then raise exception 'Duplicate account' using errcode='22023'; end if;keys:=keys||key;
 end loop;
 perform set_config('codev.publication_connections','rpc',true);
 for item in select value from jsonb_array_elements(p_accounts) loop
  select * into existing from public.publication_accounts where client_id=c.client_id and platform=item->>'platform' and external_account_id=item->>'external_account_id' for update;
  if found and existing.connection_id is distinct from c.id then raise exception 'Account already managed elsewhere' using errcode='23505'; end if;
  if found then
   update public.publication_accounts set display_name=btrim(item->>'display_name'),parent_external_id=item->>'parent_external_id',metadata=item->'metadata',last_synced_at=now(),
    status=case when existing.status='disabled' then 'disabled' else 'active' end,enabled=existing.status<>'disabled'
   where id=existing.id returning id into saved;updated:=updated+1;
  else
   insert into public.publication_accounts(client_id,platform,external_account_id,status,enabled,metadata,connection_id,display_name,parent_external_id,last_synced_at)
   values(c.client_id,item->>'platform',item->>'external_account_id','active',true,item->'metadata',c.id,btrim(item->>'display_name'),item->>'parent_external_id',now()) returning id into saved;
   inserted:=inserted+1;
  end if;
  seen:=seen||saved;
 end loop;
 update public.publication_accounts set status='unavailable',enabled=false where connection_id=c.id and not (id=any(seen)) and status in('active','revoked');
 get diagnostics unavailable=row_count;
 update public.client_connections set last_checked_at=now() where id=c.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.accounts_synced',c.client_id,'client_connection',c.id,
  jsonb_build_object('client_id',c.client_id,'connection_id',c.id,'provider',c.provider,'received',jsonb_array_length(p_accounts),'inserted',inserted,'updated',updated,'unavailable',unavailable));
 perform set_config('codev.publication_connections','',true);
 return jsonb_build_object('connection_id',c.id,'inserted',inserted,'updated',updated,'unavailable',unavailable);
end $$;

-- Assign (or clear with null) the publication account of an explicit project channel.
create function public.publication_channel_assign_account(p_project_id uuid,p_platform text,p_account_id uuid,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare ch public.publication_project_channels;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_project_id is null or p_platform not in('facebook','instagram','google_business_profile') then
  raise exception 'Invalid assignment' using errcode='22023'; end if;
 select * into ch from public.publication_project_channels where project_id=p_project_id and platform=p_platform for update;
 if not found then raise exception 'Channel not configured' using errcode='23514'; end if;
 if p_account_id is not null and not publications_private.account_assignable(p_account_id,ch.client_id,ch.platform) then
  raise exception 'Account not assignable to this channel' using errcode='23514'; end if;
 if ch.publication_account_id is not distinct from p_account_id then return ch.id; end if;
 update public.publication_project_channels set publication_account_id=p_account_id where id=ch.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.channel_account_assigned',ch.client_id,'project_channel',ch.id,
  jsonb_build_object('client_id',ch.client_id,'project_id',ch.project_id,'platform',ch.platform,'account_id',p_account_id,'previous_account_id',ch.publication_account_id));
 return ch.id;
end $$;

-- Explicit disconnect: connection disabled, credential reference cleared (returned once, server side, so the
-- vault can drop the secret), accounts unavailable. Channels keep their link (history) but stop being publishable.
-- Reconnecting later goes through publication_connection_register. Idempotent.
create function public.publication_connection_disconnect(p_client_id uuid,p_connection_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.client_connections;accounts integer:=0;channels integer:=0;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or p_connection_id is null then raise exception 'Invalid disconnect' using errcode='22023'; end if;
 select * into c from public.client_connections where id=p_connection_id for update;
 if not found or c.client_id<>p_client_id or not publications_private.connection_provider(c.provider) then raise exception 'Connection outside the client' using errcode='23514'; end if;
 if c.status='disabled' then return jsonb_build_object('connection_id',c.id,'status','disabled','already',true,'previous_reference',null); end if;
 perform set_config('codev.publication_connections','rpc',true);
 update public.client_connections set status='disabled',credential_reference=null,expires_at=null,last_checked_at=now() where id=c.id;
 update public.publication_accounts set status='unavailable',enabled=false where connection_id=c.id and status in('active','revoked');get diagnostics accounts=row_count;
 select count(*) into channels from public.publication_project_channels ch join public.publication_accounts a on a.id=ch.publication_account_id where a.connection_id=c.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.connection_disconnected',c.client_id,'client_connection',c.id,
  jsonb_build_object('client_id',c.client_id,'connection_id',c.id,'provider',c.provider,'from',c.status,'accounts_unavailable',accounts,'channels_affected',channels));
 perform set_config('codev.publication_connections','',true);
 return jsonb_build_object('connection_id',c.id,'status','disabled','already',false,'previous_reference',c.credential_reference);
end $$;

-- Listings for the cockpit: never a credential reference, never provider metadata or external ids.
create function public.publication_connections_list(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider',c.provider,'status',c.status,'connected_at',c.connected_at,'expires_at',c.expires_at,
   'has_credential',c.credential_reference is not null,
   'accounts',(select jsonb_build_object('facebook',count(*) filter(where a.platform='facebook'),'instagram',count(*) filter(where a.platform='instagram'),
     'google_business_profile',count(*) filter(where a.platform='google_business_profile'))
    from public.publication_accounts a where a.connection_id=c.id and a.status='active' and a.enabled)) order by c.provider),'[]'::jsonb)
 from public.client_connections c where c.client_id=p_client_id and publications_private.connection_provider(c.provider);
$$;
create function public.publication_accounts_available(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'platform',a.platform,'display_name',a.display_name,'status',a.status,'enabled',a.enabled,
   'connection_status',c.status,'assignable',publications_private.account_assignable(a.id,a.client_id,a.platform)) order by a.platform,a.display_name,a.id),'[]'::jsonb)
 from public.publication_accounts a join public.client_connections c on c.id=a.connection_id and c.client_id=a.client_id
 where a.client_id=p_client_id;
$$;

revoke all on function publications_private.connection_provider(text),publications_private.connection_provider_platform(text,text),
 publications_private.valid_credential_reference(text),publications_private.connection_write_allowed(),publications_private.guard_publication_connection(),
 publications_private.guard_publication_account(),publications_private.account_assignable(uuid,uuid,text),publications_private.guard_channel_account(),
 publications_private.channel_publishability(uuid) from public,anon,authenticated,service_role;
grant execute on function publications_private.connection_provider(text),publications_private.connection_provider_platform(text,text),
 publications_private.valid_credential_reference(text),publications_private.connection_write_allowed(),publications_private.guard_publication_connection(),
 publications_private.guard_publication_account(),publications_private.account_assignable(uuid,uuid,text),publications_private.guard_channel_account(),
 publications_private.channel_publishability(uuid) to service_role;
revoke all on function public.publication_connection_register(uuid,text,text,text,timestamptz,jsonb,text),public.publication_connection_set_status(uuid,text,text,timestamptz,text),
 public.publication_accounts_sync(uuid,uuid,jsonb,text),public.publication_channel_assign_account(uuid,text,uuid,text),public.publication_connection_disconnect(uuid,uuid,text),
 public.publication_connections_list(uuid),public.publication_accounts_available(uuid) from public,anon,authenticated;
grant execute on function public.publication_connection_register(uuid,text,text,text,timestamptz,jsonb,text),public.publication_connection_set_status(uuid,text,text,timestamptz,text),
 public.publication_accounts_sync(uuid,uuid,jsonb,text),public.publication_channel_assign_account(uuid,text,uuid,text),public.publication_connection_disconnect(uuid,uuid,text),
 public.publication_connections_list(uuid),public.publication_accounts_available(uuid) to service_role;
