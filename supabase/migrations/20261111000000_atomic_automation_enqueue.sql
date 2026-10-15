-- Mise en file atomique du moteur existant. Aucune activation, aucun appel externe.
-- Une panne d'insertion annule aussi l'avancement de l'échéance ; une échéance ne peut être perdue.
create function public.codev_enqueue_automation(p_automation uuid,p_due timestamptz,p_next timestamptz,p_now timestamptz)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.automations; job_id uuid;
begin
  if p_now is null or p_due is null or (p_next is not null and p_next<=p_now) then
    raise exception 'Invalid automation dates' using errcode='22023';
  end if;
  select * into a from public.automations where id=p_automation for update;
  if not found or a.status<>'active' or a.next_run_at is distinct from p_due or p_due>p_now then return null; end if;
  if (a.frequency='once') is distinct from (p_next is null) then
    raise exception 'Invalid next automation date' using errcode='22023';
  end if;
  -- Reconnaît aussi une ancienne clé contenant +00:00 (ancienne version JS) au lieu de Z.
  select id into job_id from public.jobs where automation_id=a.id and scheduled_for=p_due and trigger='schedule' limit 1;
  if job_id is null then
  insert into public.jobs(automation_id,run_type,agent_id,client_id,project_id,payload,scheduled_for,idempotency_key,trigger)
  values(a.id,a.run_type,a.agent_id,a.client_id,a.project_id,a.config,p_due,'auto:'||a.id::text||':'||to_char(p_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'schedule')
  on conflict(idempotency_key) do nothing returning id into job_id;
  if job_id is null then
    select id into job_id from public.jobs where automation_id=a.id and scheduled_for=p_due and trigger='schedule';
    if job_id is null then raise exception 'Automation job conflict'; end if;
  end if;
  end if;
  update public.automations set next_run_at=p_next,last_run_at=p_now,status=case when p_next is null then 'completed' else 'active' end where id=a.id;
  return job_id;
end $$;

-- Une action manuelle ne doit pas vider la file globale ni lancer un autre travail (notamment un envoi).
create function public.codev_claim_job(p_job uuid,p_worker text,p_lease_seconds integer)
returns setof public.jobs language plpgsql security invoker set search_path=pg_catalog,public as $$
declare candidate public.jobs;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 120 then
    raise exception 'Invalid worker' using errcode='22023';
  end if;
  select * into candidate from public.jobs where id=p_job for update skip locked;
  if not found then return; end if;
  if candidate.status='running' and candidate.lease_expires_at<now() then
    update public.jobs set status=case when attempts>=max_attempts then 'failed' else 'queued' end,
      last_error=left('Bail expiré : exécution interrompue.'||coalesce(' '||last_error,''),2000),
      worker_id=null,lease_expires_at=null,finished_at=case when attempts>=max_attempts then now() else null end
      where id=p_job returning * into candidate;
  end if;
  if candidate.status<>'queued' or candidate.scheduled_for>now() then return; end if;
  return query update public.jobs set status='running',attempts=attempts+1,worker_id=p_worker,
    lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),900))),
    started_at=coalesce(started_at,now()) where id=p_job returning *;
end $$;

revoke all on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz),public.codev_claim_job(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz),public.codev_claim_job(uuid,text,integer) to service_role;
comment on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz) is 'Réserve une échéance et insère son job dans une transaction unique ; aucune exécution.';
comment on function public.codev_claim_job(uuid,text,integer) is 'Réserve uniquement le job demandé, sans effet sur les autres jobs.';
