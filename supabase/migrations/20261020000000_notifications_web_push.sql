-- Generic administrative notifications: no client names, metrics, instructions or secrets in payloads.
create table public.admin_notifications (
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique check(length(event_key)<=200),
 category text not null check(category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed')),
 href text not null check(href ~ '^/(reports|advertising/analyses|agents)/[0-9a-f-]{36}$' or href='/work?kind=incident'),
 created_at timestamptz not null default now()
);
create index admin_notifications_recent on public.admin_notifications(created_at desc);
create table public.admin_notification_reads (
 notification_id uuid not null references public.admin_notifications(id) on delete cascade,
 user_id text not null check(length(user_id) between 1 and 100),
 read_at timestamptz not null default now(), primary key(notification_id,user_id)
);
create index admin_notification_reads_user on public.admin_notification_reads(user_id,notification_id);
create table public.admin_notification_preferences (
 user_id text primary key check(length(user_id) between 1 and 100),
 categories text[] not null default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed'],
 push_enabled boolean not null default false,
 push_categories text[] not null default array['report_ready','analysis_failed','incident','delivery_failed'],
 check(categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed']),
 check(push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed'])
);
create table public.admin_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id text not null check(length(user_id) between 1 and 100),
 device_id uuid not null, endpoint text not null unique check(length(endpoint)<=2048),
 keys jsonb not null check(jsonb_typeof(keys)='object' and pg_column_size(keys)<=1024),
 created_at timestamptz not null default now(), unique(user_id,device_id)
);
create index admin_push_subscriptions_user on public.admin_push_subscriptions(user_id);
create table public.admin_push_deliveries (
 notification_id uuid not null references public.admin_notifications(id) on delete cascade,
 subscription_id uuid not null references public.admin_push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','expired','skipped')),
 token uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(notification_id,subscription_id)
);
create index admin_push_deliveries_pending on public.admin_push_deliveries(created_at) where state='pending';
create index admin_push_deliveries_subscription on public.admin_push_deliveries(subscription_id);
do $$ declare t text; begin
 foreach t in array array['admin_notifications','admin_notification_reads','admin_notification_preferences','admin_push_subscriptions','admin_push_deliveries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create function codev_private.notification_event() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare cat text; key text; url text;
begin
 if tg_table_name='reports' then
  if new.status<>'ready_for_review' or (tg_op='UPDATE' and new.status=old.status and new.version=old.version) then return new; end if;
  cat:='report_ready'; key:='report:'||new.id||':v'||new.version; url:='/reports/'||new.id;
 elsif tg_table_name='agent_runs' then
  if new.status not in ('completed','failed') or (tg_op='UPDATE' and new.status=old.status) or coalesce(new.metadata->>'run_type','') not in ('google_ads_read_only','ads.monitor') then return new; end if;
  cat:=case when new.status='completed' then 'analysis_completed' else 'analysis_failed' end;
  key:='analysis:'||new.id||':'||new.status;
  url:=case when new.metadata->>'run_type'='google_ads_read_only' then '/advertising/analyses/'||new.id else '/agents/'||new.agent_id end;
 elsif tg_table_name='incidents' then
  if new.severity not in ('high','critical') or new.status<>'open' or (tg_op='UPDATE' and old.status='open' and old.severity in ('high','critical')) then return new; end if;
  cat:='incident'; key:='incident:'||new.id; url:='/work?kind=incident';
 elsif tg_table_name='report_deliveries' then
  if new.state not in ('failed','uncertain') or (tg_op='UPDATE' and new.state=old.state) then return new; end if;
  cat:='delivery_failed'; key:='email:'||new.report_id||':v'||new.version; url:='/reports/'||new.report_id;
 else return new;
 end if;
 insert into public.admin_notifications(event_key,category,href) values(key,cat,url) on conflict(event_key) do nothing;
 return new;
end $$;
create trigger reports_notify after insert or update on public.reports for each row execute function codev_private.notification_event();
create trigger analyses_notify after insert or update on public.agent_runs for each row execute function codev_private.notification_event();
create trigger incidents_notify after insert or update on public.incidents for each row execute function codev_private.notification_event();
create trigger email_failure_notify after insert or update on public.report_deliveries for each row execute function codev_private.notification_event();
revoke all on function codev_private.notification_event() from public,anon,authenticated;
grant execute on function codev_private.notification_event() to service_role;

create function codev_private.enqueue_notification_push() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 insert into public.admin_push_deliveries(notification_id,subscription_id)
 select new.id,s.id from public.admin_push_subscriptions s join public.admin_notification_preferences p on p.user_id=s.user_id
 where p.push_enabled and new.category=any(p.push_categories);
 return new;
end $$;
create trigger enqueue_notification_push after insert on public.admin_notifications for each row execute function codev_private.enqueue_notification_push();
revoke all on function codev_private.enqueue_notification_push() from public,anon,authenticated;
grant execute on function codev_private.enqueue_notification_push() to service_role;

create function public.codev_subscribe_push(p_user_id text,p_device_id uuid,p_endpoint text,p_keys jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('push:'||p_user_id,0));
 if (select count(*) from public.admin_push_subscriptions where user_id=p_user_id)>=10 and not exists(select 1 from public.admin_push_subscriptions where user_id=p_user_id and device_id=p_device_id) then raise exception 'Device limit reached' using errcode='54000'; end if;
 insert into public.admin_push_subscriptions(user_id,device_id,endpoint,keys) values(p_user_id,p_device_id,p_endpoint,p_keys)
 on conflict(user_id,device_id) do update set endpoint=excluded.endpoint,keys=excluded.keys returning id into result;
 return result;
end $$;
revoke all on function public.codev_subscribe_push(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.codev_subscribe_push(text,uuid,text,jsonb) to service_role;

create function public.codev_claim_push(p_token uuid,p_limit integer default 10) returns setof public.admin_push_deliveries
language sql security invoker set search_path=pg_catalog as $$
 update public.admin_push_deliveries d set state='sending',token=p_token,updated_at=now()
 where (d.notification_id,d.subscription_id) in (
  select notification_id,subscription_id from public.admin_push_deliveries where state='pending' order by created_at limit least(greatest(p_limit,1),10) for update skip locked
 ) returning d.*;
$$;
revoke all on function public.codev_claim_push(uuid,integer) from public,anon,authenticated;
grant execute on function public.codev_claim_push(uuid,integer) to service_role;
notify pgrst,'reload schema';
create function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;
revoke all on function public.codev_unread_notifications(text) from public,anon,authenticated;
grant execute on function public.codev_unread_notifications(text) to service_role;
