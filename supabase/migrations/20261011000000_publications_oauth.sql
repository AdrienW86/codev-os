-- Lot 4.3 P11-a — OAuth connections: encrypted credential store, single-use OAuth states, OAuth audit.
-- Additive and forward-only. No existing row is changed. Nothing is published.
--
-- Credential store: AES-256-GCM ciphertext produced and decrypted by the server only (the key lives in the server
-- environment, never in the database). The reference ("vault:connection/<uuid>") is the only thing the business
-- tables keep (client_connections.credential_reference, P9). Rows are immutable: a rotation writes a new reference.
-- OAuth state: only the SHA-256 of the random state travels to the database; single use, short TTL, bound to the
-- provider, the CODE-V client, the initiating admin and (optionally) the project to come back to.

-- 1. Encrypted credential store (server only).
create table public.publication_credential_secrets(
 reference text primary key check(publications_private.valid_credential_reference(reference)),
 provider text not null check(publications_private.connection_provider(provider)),
 key_id text not null check(key_id ~ '^[a-z0-9_-]{1,40}$'),
 iv bytea not null check(octet_length(iv)=12),
 ciphertext bytea not null check(octet_length(ciphertext) between 16 and 65536),
 auth_tag bytea not null check(octet_length(auth_tag)=16),
 created_at timestamptz not null default now()
);
create function publications_private.guard_credential_secret() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'Credential secrets are immutable: rotate to a new reference' using errcode='55000'; end $$;
create trigger publication_credential_secret_immutable before update on public.publication_credential_secrets
 for each row execute function publications_private.guard_credential_secret();
create trigger publication_credential_secret_no_truncate before truncate on public.publication_credential_secrets
 for each statement execute function publications_private.prevent_history_change();
alter table public.publication_credential_secrets enable row level security;
revoke all on public.publication_credential_secrets from public,anon,authenticated,service_role;
-- Insert (store), select (read), delete (disconnect / rotation cleanup). No update, no truncate.
grant select,insert,delete on public.publication_credential_secrets to service_role;

-- 2. OAuth states.
create table public.publication_oauth_states(
 id uuid primary key default gen_random_uuid(),
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 provider text not null check(publications_private.connection_provider(provider)),
 client_id uuid not null references public.clients(id) on delete restrict,
 project_id uuid,
 actor_id text not null check(actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 constraint publication_oauth_states_project_fk foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict,
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check(consumed_at is null or consumed_at>=created_at)
);
create index publication_oauth_states_expiry on public.publication_oauth_states(expires_at) where consumed_at is null;
create function publications_private.guard_oauth_state() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'OAuth states are kept for audit' using errcode='55000'; end if;
 if (new.id,new.state_hash,new.provider,new.client_id,new.project_id,new.actor_id,new.created_at,new.expires_at)
   is distinct from (old.id,old.state_hash,old.provider,old.client_id,old.project_id,old.actor_id,old.created_at,old.expires_at)
  or old.consumed_at is not null then raise exception 'OAuth state is single use and immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger publication_oauth_state_guard before update or delete on public.publication_oauth_states
 for each row execute function publications_private.guard_oauth_state();
create trigger publication_oauth_state_no_truncate before truncate on public.publication_oauth_states
 for each statement execute function publications_private.prevent_history_change();
alter table public.publication_oauth_states enable row level security;
revoke all on public.publication_oauth_states from public,anon,authenticated,service_role;
-- Invoker RPCs: the server role inserts and consumes (single update of consumed_at, enforced by the guard trigger).
grant select,insert,update on public.publication_oauth_states to service_role;

-- Start: store the state hash for one provider / client / admin (10 minutes). Audited (no state, no secret).
create function public.publication_oauth_state_create(p_provider text,p_client_id uuid,p_project_id uuid,p_state_hash text,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare id uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or not publications_private.connection_provider(p_provider)
  or p_client_id is null or p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid OAuth state' using errcode='22023'; end if;
 if not exists(select 1 from public.clients where clients.id=p_client_id) then raise exception 'Invalid client' using errcode='23514'; end if;
 if p_project_id is not null and not exists(select 1 from public.projects where projects.id=p_project_id and client_id=p_client_id) then raise exception 'Project outside the client' using errcode='23514'; end if;
 insert into public.publication_oauth_states(state_hash,provider,client_id,project_id,actor_id,expires_at)
 values(p_state_hash,p_provider,p_client_id,p_project_id,p_actor_id,now()+interval '10 minutes') returning publication_oauth_states.id into id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.oauth_started',p_client_id,'client',p_client_id,jsonb_build_object('client_id',p_client_id,'provider',p_provider));
 return id;
end $$;

-- Callback: consume the state BEFORE any code exchange. Refused when unknown, already used, expired, issued for
-- another provider or by another admin. Single use even under concurrent callbacks (row lock).
create function public.publication_oauth_state_consume(p_provider text,p_state_hash text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare s public.publication_oauth_states;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or not publications_private.connection_provider(p_provider)
  or p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid OAuth state' using errcode='22023'; end if;
 select * into s from public.publication_oauth_states where state_hash=p_state_hash for update;
 if not found then raise exception 'Unknown OAuth state' using errcode='23514'; end if;
 if s.consumed_at is not null then raise exception 'OAuth state already used' using errcode='55000'; end if;
 if s.provider<>p_provider then raise exception 'OAuth state issued for another provider' using errcode='23514'; end if;
 if s.actor_id<>p_actor_id then raise exception 'OAuth state issued for another admin' using errcode='23514'; end if;
 update public.publication_oauth_states set consumed_at=now() where id=s.id;
 if s.expires_at<=now() then
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.oauth_failed',s.client_id,'client',s.client_id,jsonb_build_object('client_id',s.client_id,'provider',s.provider,'code','state_expired'));
  return jsonb_build_object('status','expired','client_id',s.client_id,'project_id',s.project_id);
 end if;
 return jsonb_build_object('status','valid','client_id',s.client_id,'project_id',s.project_id);
end $$;

-- OAuth outcome audit (completed / failed / refreshed): safe codes and counts only.
create function public.publication_oauth_record(p_client_id uuid,p_provider text,p_outcome text,p_code text,p_counts jsonb,p_actor_id text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or not publications_private.connection_provider(p_provider)
  or p_outcome not in('oauth_completed','oauth_failed','connection_refreshed') or (p_code is not null and p_code !~ '^[a-z0-9_]{1,60}$')
  or (p_counts is not null and (jsonb_typeof(p_counts)<>'object' or exists(select 1 from jsonb_each(p_counts) e where e.key not in('facebook','instagram','google_business_profile','accounts') or jsonb_typeof(e.value)<>'number')))
  then raise exception 'Invalid OAuth record' using errcode='22023'; end if;
 if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Invalid client' using errcode='23514'; end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.'||p_outcome,p_client_id,'client',p_client_id,
  jsonb_strip_nulls(jsonb_build_object('client_id',p_client_id,'provider',p_provider,'code',p_code,'counts',p_counts,
   'connection_id',(select id from public.client_connections where client_id=p_client_id and provider=p_provider))));
end $$;

revoke all on function publications_private.guard_credential_secret(),publications_private.guard_oauth_state() from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_credential_secret(),publications_private.guard_oauth_state() to service_role;
revoke all on function public.publication_oauth_state_create(text,uuid,uuid,text,text),public.publication_oauth_state_consume(text,text,text),
 public.publication_oauth_record(uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_oauth_state_create(text,uuid,uuid,text,text),public.publication_oauth_state_consume(text,text,text),
 public.publication_oauth_record(uuid,text,text,text,jsonb,text) to service_role;
