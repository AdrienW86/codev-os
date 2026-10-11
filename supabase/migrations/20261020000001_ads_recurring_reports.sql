-- Recurring report configuration and immutable occurrence snapshots. Existing scheduler and delivery claims.
create table public.client_ads_report_settings (
 client_id uuid primary key references public.clients(id) on delete restrict,
 revision integer not null default 1 check(revision>0), config jsonb not null check(jsonb_typeof(config)='object' and pg_column_size(config)<12000),
 next_due_at timestamptz not null, next_prepare_at timestamptz not null, updated_at timestamptz not null default now()
);
create index ads_report_settings_due on public.client_ads_report_settings(next_prepare_at);
create table public.ads_report_occurrences (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete restrict,
 revision integer not null, config jsonb not null, period_window jsonb not null,
 due_at timestamptz not null, prepare_at timestamptz not null,
 report_id uuid not null default gen_random_uuid() unique,
 preparation text not null default 'queued' check(preparation in ('queued','ready','failed','cancelled')),
 transport text not null default 'pending' check(transport in ('pending','prepare_only','blocked','late','paused','accepted','failed','uncertain')),
 reason text, created_at timestamptz not null default now(), unique(client_id,revision,due_at)
);
create index ads_report_occurrences_client on public.ads_report_occurrences(client_id,due_at desc);
alter table public.client_ads_report_settings enable row level security;
alter table public.ads_report_occurrences enable row level security;
revoke all on public.client_ads_report_settings,public.ads_report_occurrences from public,anon,authenticated;
grant select,insert,update on public.client_ads_report_settings,public.ads_report_occurrences to service_role;

create function public.codev_save_ads_report_settings(p_client_id uuid,p_revision integer,p_config jsonb,p_due timestamptz,p_prepare timestamptz) returns integer
language plpgsql security invoker set search_path=pg_catalog as $$
declare r integer;
begin
 perform 1 from public.clients where id=p_client_id for update;
 if not found or p_prepare>p_due or jsonb_typeof(p_config)<>'object' or p_config->>'recipientConfirmed'<>'true' then raise exception 'Invalid report configuration' using errcode='22023'; end if;
 select revision into r from public.client_ads_report_settings where client_id=p_client_id for update;
 if coalesce(r,0)<>p_revision then raise exception 'Configuration changed' using errcode='40001'; end if;
 insert into public.client_ads_report_settings(client_id,revision,config,next_due_at,next_prepare_at)
 values(p_client_id,p_revision+1,p_config,p_due,p_prepare)
 on conflict(client_id) do update set revision=excluded.revision,config=excluded.config,next_due_at=excluded.next_due_at,next_prepare_at=excluded.next_prepare_at,updated_at=now();
 -- Existing occurrence payload, scope and recipient never change. Future old jobs are cancelled.
 update public.jobs set status='cancelled' where client_id=p_client_id and run_type in ('ads.report.prepare','ads.report.send') and status='queued';
 update public.ads_report_occurrences set preparation='cancelled' where client_id=p_client_id and preparation in ('queued','failed');
 update public.ads_report_occurrences set transport='paused',reason='configuration_changed' where client_id=p_client_id and transport='pending';
 return p_revision+1;
end $$;
create function public.codev_enqueue_ads_report(p_client_id uuid,p_revision integer,p_due timestamptz,p_window jsonb,p_next_due timestamptz,p_next_prepare timestamptz,p_manual boolean default false) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare s public.client_ads_report_settings; o uuid; a uuid; last_end date;
begin
 select * into s from public.client_ads_report_settings where client_id=p_client_id for update;
 if not found or s.revision<>p_revision or s.config->>'enabled'<>'true' or (not p_manual and s.next_due_at<>p_due) then return null; end if;
 select id into a from public.agents where agent_type='report' and enabled and status='Actif' order by created_at limit 1;
 if a is null then raise exception 'Report agent required' using errcode='55000'; end if;
 -- Under the settings lock, anchor a changed schedule/resume to the last finalized day.
 select max((period_window->>'end')::date) into last_end from public.ads_report_occurrences
 where client_id=p_client_id and preparation='ready' and due_at<p_due
 and config->>'accountId' is not distinct from s.config->>'accountId'
 and coalesce(config->>'dataTimezone',config->>'timezone')=coalesce(s.config->>'dataTimezone',s.config->>'timezone');
 if last_end is not null then
   if last_end >= (p_window->>'end')::date then
     if not p_manual then update public.client_ads_report_settings set next_due_at=p_next_due,next_prepare_at=p_next_prepare where client_id=p_client_id; end if;
     return null;
   end if;
   p_window=jsonb_set(p_window,'{start}',to_jsonb((last_end+1)::text));
 end if;

 insert into public.ads_report_occurrences(client_id,revision,config,period_window,due_at,prepare_at)
 values(p_client_id,s.revision,s.config,p_window,p_due,(p_window->>'prepareAt')::timestamptz)
 on conflict(client_id,revision,due_at) do nothing returning id into o;
 if o is null then select id into o from public.ads_report_occurrences where client_id=p_client_id and revision=s.revision and due_at=p_due; end if;
 insert into public.jobs(run_type,client_id,agent_id,payload,scheduled_for,idempotency_key,trigger)
 values('ads.report.prepare',p_client_id,a,jsonb_build_object('occurrenceId',o),case when p_manual then now() else (p_window->>'prepareAt')::timestamptz end,'ads-report:'||o||':prepare','system'),
 ('ads.report.send',p_client_id,a,jsonb_build_object('occurrenceId',o),p_due,'ads-report:'||o||':send','system') on conflict(idempotency_key) do nothing;
 if not p_manual then update public.client_ads_report_settings set next_due_at=p_next_due,next_prepare_at=p_next_prepare where client_id=p_client_id; end if;
 return o;
end $$;
-- Atomic publication of a prepared snapshot: workers cannot publish after losing their job lease.
create function public.codev_store_ads_report(p_occurrence uuid,p_job uuid,p_worker text,p_report jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare o public.ads_report_occurrences;
begin
 select * into o from public.ads_report_occurrences where id=p_occurrence;
 if not found then return false; end if;
 perform 1 from public.client_ads_report_settings where client_id=o.client_id for update;
 select * into o from public.ads_report_occurrences where id=p_occurrence for update;
 if not found then return false; end if;
 perform 1 from public.client_ads_report_settings where client_id=o.client_id and revision=o.revision and config->>'enabled'='true' for update;
 if not found then return false; end if;
 perform 1 from public.jobs where id=p_job and client_id=o.client_id and run_type='ads.report.prepare' and payload->>'occurrenceId'=o.id::text and worker_id=p_worker and status='running' and lease_expires_at>now() for update;
 if not found then return false; end if;
 if not exists(select 1 from public.reports where id=o.report_id) then
 insert into public.reports(id,client_id,kind,period_start,period_end,status,version,generated_at,title,summary,internal_content,client_content,scope)
 values(o.report_id,o.client_id,'google_ads',(o.period_window->>'start')::date,(o.period_window->>'end')::date,'ready_for_review',1,now(),p_report->>'title',p_report->>'summary',p_report->'internal_content',p_report->'client_content',p_report->'scope');
 end if;
 update public.ads_report_occurrences set preparation='ready',reason=null where id=o.id;
 return true;
end $$;
-- Authorization snapshot + pause/revision/time checks and existing send reservation share a transaction.
create function public.codev_claim_recurring_delivery(p_occurrence uuid,p_job uuid,p_worker text,p_report_id uuid,p_version integer,p_token uuid,p_recipient text,p_subject text,p_body text,p_content jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare o public.ads_report_occurrences; s public.client_ads_report_settings;
begin
 select * into o from public.ads_report_occurrences where id=p_occurrence;
 if not found then return false; end if;
 perform 1 from public.client_ads_report_settings where client_id=o.client_id for update;
 select * into o from public.ads_report_occurrences where id=p_occurrence for update;
 if not found or o.report_id<>p_report_id or o.preparation<>'ready' or o.transport<>'pending' or o.config->>'recipient'<>p_recipient or o.config->>'recipientConfirmed'<>'true' or o.config->>'transport'<>'approved_auto' then return false; end if;
 select * into s from public.client_ads_report_settings where client_id=o.client_id for update;
 if not found or s.revision<>o.revision or s.config->>'enabled'<>'true' or now()<o.due_at or now()>o.due_at+make_interval(mins=>(o.config->>'lateMinutes')::integer) then return false; end if;
 perform 1 from public.reports where id=p_report_id and client_id=o.client_id;
 if not found then return false; end if;
 perform 1 from public.jobs where id=p_job and worker_id=p_worker and client_id=o.client_id and run_type='ads.report.send' and payload->>'occurrenceId'=o.id::text and status='running' and lease_expires_at>now() for update;
 if not found then return false; end if;
 return public.codev_claim_report_delivery(p_report_id,p_version,p_token,p_recipient,p_subject,p_body,p_content);
end $$;
create function codev_private.ads_occurrence_guard() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.client_id,new.revision,new.config,new.period_window,new.due_at,new.prepare_at,new.report_id) is distinct from (old.client_id,old.revision,old.config,old.period_window,old.due_at,old.prepare_at,old.report_id) then raise exception 'Occurrence frozen' using errcode='55000'; end if;
 if new.transport in ('blocked','late') and new.transport is distinct from old.transport then
 insert into public.admin_notifications(event_key,category,href) values('ads-report:'||new.id||':'||new.transport,'delivery_failed',case when exists(select 1 from public.reports where id=new.report_id) then '/reports/'||new.report_id else '/notifications' end) on conflict(event_key) do nothing;
 end if;
 return new;
end $$;
create trigger ads_occurrence_frozen before update on public.ads_report_occurrences for each row execute function codev_private.ads_occurrence_guard();
revoke all on function public.codev_save_ads_report_settings(uuid,integer,jsonb,timestamptz,timestamptz),public.codev_enqueue_ads_report(uuid,integer,timestamptz,jsonb,timestamptz,timestamptz,boolean),public.codev_store_ads_report(uuid,uuid,text,jsonb),public.codev_claim_recurring_delivery(uuid,uuid,text,uuid,integer,uuid,text,text,text,jsonb),codev_private.ads_occurrence_guard() from public,anon,authenticated;
grant execute on function public.codev_save_ads_report_settings(uuid,integer,jsonb,timestamptz,timestamptz),public.codev_enqueue_ads_report(uuid,integer,timestamptz,jsonb,timestamptz,timestamptz,boolean),public.codev_store_ads_report(uuid,uuid,text,jsonb),public.codev_claim_recurring_delivery(uuid,uuid,text,uuid,integer,uuid,text,text,text,jsonb),codev_private.ads_occurrence_guard() to service_role;
