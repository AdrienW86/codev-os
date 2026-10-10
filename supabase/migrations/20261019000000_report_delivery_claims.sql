-- Additive server-only send claims. One provider attempt per approved version; uncertain sends stay frozen.
create table public.report_deliveries (
  report_id uuid not null references public.reports(id) on delete restrict,
  version integer not null check(version > 0),
  token uuid not null,
  state text not null default 'sending' check(state in ('sending','accepted','failed','uncertain')),
  recipient text not null check(length(recipient) <= 320 and recipient !~ '[[:space:],;<>]'),
  subject text not null check(length(subject) between 1 and 200),
  body text not null check(length(body) between 1 and 100000),
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(report_id,version)
);
alter table public.report_deliveries enable row level security;
revoke all on public.report_deliveries from public, anon, authenticated;
grant select,insert,update on public.report_deliveries to service_role;

-- Future version snapshots are transactional. Historic rows are preserved unchanged.
create function codev_private.report_version_snapshot() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.report_versions(report_id,version,summary,internal_content,client_content,scope,created_by)
    values(new.id,new.version,new.summary,new.internal_content,new.client_content,new.scope,'server');
  end if;
  return new;
end $$;
create trigger report_version_snapshot after insert or update on public.reports for each row execute function codev_private.report_version_snapshot();
revoke all on function codev_private.report_version_snapshot() from public,anon,authenticated;
grant execute on function codev_private.report_version_snapshot() to service_role;

create function codev_private.report_delivery_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.version not in (old.version,old.version+1) then raise exception 'Invalid version transition' using errcode='55000'; end if;
  if old.status in ('sent','archived') and (new.version<>old.version or new.title is distinct from old.title or new.summary is distinct from old.summary or new.client_content is distinct from old.client_content or new.internal_content is distinct from old.internal_content) then
    raise exception 'Report frozen' using errcode='55000';
  end if;
  if exists(select 1 from public.report_deliveries d where d.report_id=old.id and d.state in ('sending','uncertain')) then
    raise exception 'Report delivery pending or uncertain' using errcode='55000';
  end if;
  if (new.client_content is distinct from old.client_content or new.title is distinct from old.title or new.summary is distinct from old.summary or new.internal_content is distinct from old.internal_content) and new.version <> old.version+1 then
    raise exception 'Report content requires next version' using errcode='55000';
  end if;
  if old.status='approved' and new.version<>old.version then
    new.status:='ready_for_review'; new.approved_at:=null; new.approved_by:=null; new.approved_version:=null;
  end if;
  return new;
end $$;
create trigger report_delivery_guard before update on public.reports for each row execute function codev_private.report_delivery_guard();
revoke all on function codev_private.report_delivery_guard() from public,anon,authenticated;
grant execute on function codev_private.report_delivery_guard() to service_role;

create function public.codev_claim_report_delivery(p_report_id uuid,p_version integer,p_token uuid,p_recipient text,p_subject text,p_body text,p_content jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.reports;
begin
  select * into r from public.reports where id=p_report_id for update;
  if not found or r.status<>'approved' or r.version<>p_version or r.approved_version<>p_version or r.client_id is null
    or r.title<>p_subject or r.client_content is distinct from p_content then return false; end if;
  if p_token is null or p_recipient is null or p_recipient !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[a-zA-Z]{2,}$' then
    raise exception 'Invalid recipient' using errcode='22023';
  end if;
  insert into public.report_deliveries(report_id,version,token,recipient,subject,body)
    values(p_report_id,p_version,p_token,p_recipient,p_subject,p_body) on conflict do nothing;
  return found;
end $$;
revoke all on function public.codev_claim_report_delivery(uuid,integer,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.codev_claim_report_delivery(uuid,integer,uuid,text,text,text,jsonb) to service_role;

create function public.codev_finish_report_delivery(p_report_id uuid,p_version integer,p_token uuid,p_state text,p_provider_id text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare recipient_domain text;
begin
  perform 1 from public.reports where id=p_report_id for update;
  if p_state not in ('accepted','failed','uncertain') then raise exception 'Invalid state' using errcode='22023'; end if;
  update public.report_deliveries set state=p_state,provider_id=left(p_provider_id,200),updated_at=now()
    where report_id=p_report_id and version=p_version and token=p_token and state='sending'
    returning split_part(recipient,'@',2) into recipient_domain;
  if not found then return false; end if;
  if p_state='accepted' then
    update public.reports set status='sent',sent_at=now(),delivery=jsonb_build_object('mode','email','provider','resend','state','accepted','message_id',left(p_provider_id,200),'recipient_domain',recipient_domain)
      where id=p_report_id and version=p_version and status='approved' and approved_version=p_version;
    if not found then raise exception 'Approved version changed' using errcode='40001'; end if;
  end if;
  return true;
end $$;
revoke all on function public.codev_finish_report_delivery(uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.codev_finish_report_delivery(uuid,integer,uuid,text,text) to service_role;
notify pgrst,'reload schema';
