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

revoke all on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz) to service_role;
comment on function public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz) is 'Réserve une échéance et insère son job dans une transaction unique ; aucune exécution.';
notify pgrst, 'reload schema';
