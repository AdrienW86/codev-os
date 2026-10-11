-- PR #16 hardening. Additive functions and expanded href constraint, no data/table DROP.
-- Dependencies: all migrations through 20261020000001. Apply separately with history recording.
-- Preserve the historical files: they may already be applied on another deployment.
alter table public.admin_notifications drop constraint admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
 check(href ~ '^/(reports|advertising/analyses|agents)/[0-9a-f-]{36}$' or href in ('/work?kind=incident','/notifications'));

create or replace function public.codev_save_ads_report_settings(p_client_id uuid,p_revision integer,p_config jsonb,p_due timestamptz,p_prepare timestamptz) returns integer
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
 -- A settings change revokes approval of unsent reports from the old revision.
 -- Already reserved/uncertain transports are irrevocable and remain frozen.
 update public.reports r set version=r.version+1,status='ready_for_review',approved_at=null,approved_by=null,approved_version=null
 where r.status='approved' and exists(select 1 from public.ads_report_occurrences o where o.report_id=r.id and o.client_id=p_client_id)
 and not exists(select 1 from public.report_deliveries d where d.report_id=r.id and d.state in ('sending','uncertain'));
 return p_revision+1;
end $$;

create or replace function public.codev_claim_report_delivery(p_report_id uuid,p_version integer,p_token uuid,p_recipient text,p_subject text,p_body text,p_content jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.reports;
begin
  select * into r from public.reports where id=p_report_id for update;
  if not found or r.status<>'approved' or r.version is distinct from p_version or r.approved_version is distinct from p_version or r.client_id is null
    or r.title<>p_subject or r.client_content is distinct from p_content then return false; end if;
  -- Manual transport must use the same frozen recipient as scheduled transport.
  if exists(select 1 from public.ads_report_occurrences o where o.report_id=p_report_id and o.config->>'recipient' is distinct from p_recipient) then return false; end if;
  if p_token is null or p_recipient is null or p_recipient !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[a-zA-Z]{2,}$' then
    raise exception 'Invalid recipient' using errcode='22023';
  end if;
  insert into public.report_deliveries(report_id,version,token,recipient,subject,body)
    values(p_report_id,p_version,p_token,p_recipient,p_subject,p_body) on conflict do nothing;
  return found;
end $$;

create or replace function codev_private.ads_occurrence_guard() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.client_id,new.revision,new.config,new.period_window,new.due_at,new.prepare_at,new.report_id) is distinct from (old.client_id,old.revision,old.config,old.period_window,old.due_at,old.prepare_at,old.report_id) then raise exception 'Occurrence frozen' using errcode='55000'; end if;
 if (new.preparation='failed' and new.preparation is distinct from old.preparation) or (new.transport in ('blocked','late') and new.transport is distinct from old.transport) then
 insert into public.admin_notifications(event_key,category,href) values('ads-report:'||new.id||':'||case when new.preparation='failed' and new.preparation is distinct from old.preparation then 'preparation_failed' else new.transport end,'delivery_failed',case when exists(select 1 from public.reports where id=new.report_id) then '/reports/'||new.report_id else '/notifications' end) on conflict(event_key) do nothing;
 end if;
 return new;
end $$;

-- Fence error/status writes just like successful publication. Lock order: settings, occurrence, job.
create function public.codev_record_ads_report_outcome(p_occurrence uuid,p_job uuid,p_worker text,p_phase text,p_state text,p_reason text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare o public.ads_report_occurrences;
begin
 select * into o from public.ads_report_occurrences where id=p_occurrence;
 if not found then return false; end if;
 perform 1 from public.client_ads_report_settings where client_id=o.client_id for update;
 select * into o from public.ads_report_occurrences where id=p_occurrence for update;
 if not found then return false; end if;
 perform 1 from public.client_ads_report_settings where client_id=o.client_id and revision=o.revision and config->>'enabled'='true';
 if not found then return false; end if;
 if p_phase not in ('prepare','send') or p_reason not in ('preparation_failed','approval_required','not_due','late','prepare_only','delivery_failed') and p_reason is not null then return false; end if;
 perform 1 from public.jobs where id=p_job and client_id=o.client_id and run_type='ads.report.'||p_phase
 and payload->>'occurrenceId'=o.id::text and worker_id=p_worker and status='running' and lease_expires_at>now() for update;
 if not found then return false; end if;
 if p_phase='prepare' and p_state='failed' then
   update public.ads_report_occurrences set preparation='failed',reason=p_reason where id=o.id and preparation in ('queued','failed');
 elsif p_phase='send' and p_state in ('pending','prepare_only','blocked','late','accepted','failed','uncertain') then
   update public.ads_report_occurrences set transport=p_state,reason=p_reason where id=o.id and transport='pending';
 else return false;
 end if;
 return found;
end $$;
revoke all on function public.codev_record_ads_report_outcome(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.codev_record_ads_report_outcome(uuid,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
