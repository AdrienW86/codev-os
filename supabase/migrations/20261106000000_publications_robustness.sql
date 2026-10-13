-- Socle Publications, phase 8 (#47) : robustesse et charge du pipeline planifié. Rien n'est activé : la diffusion
-- planifiée reste sous PUBLICATIONS_SCHEDULED_DELIVERY (vide par défaut) et sous les interrupteurs en base.
-- Aucune ligne existante modifiée, aucune table créée.

-- 1. Garde de retard (2 h) appliquée aussi aux réessais automatiques. Avant : le retard se mesurait sur run_at, que
-- publication_job_complete repousse à chaque réessai (1 min … 6 h, ou délai imposé par le fournisseur) : un envoi dû à
-- 9 h, en échec temporaire, pouvait partir à 11 h 30 sans aucun humain. Désormais la référence est l'heure due de la
-- diffusion (scheduled_for), ou la dernière relance par un humain (publication.delivery_retried) si elle est plus récente :
-- une tâche dont la référence dépasse la tolérance est bloquée (late_schedule, notifiée, relançable depuis la fiche).
-- Le reste est inchangé (verrou SKIP LOCKED, 50 blocages au plus par appel, puis publication_job_claim telle quelle).
create or replace function public.publication_job_claim_on_time(p_worker_id text,p_lease_seconds integer,p_max_late_seconds integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j record;n integer:=0;late timestamptz;
begin
 if p_max_late_seconds is null or p_max_late_seconds not between 60 and 86400 then raise exception 'Invalid claim' using errcode='22023'; end if;
 if coalesce((select emergency_stop from public.publication_settings limit 1),true) then return null; end if;
 late:=now()-make_interval(secs=>p_max_late_seconds);
 for j in select pj.delivery_id from public.publication_jobs pj join public.publication_deliveries d on d.id=pj.delivery_id
   where pj.type='deliver' and pj.dispatched_at is null
    and (pj.status='pending' or (pj.status='processing' and pj.lease_expires_at<=now()))
    and d.status in('scheduled','retryable_error','processing') and d.revision_id is not null
    and (pj.run_at<late or greatest(d.scheduled_for,(select max(e.created_at) from public.publication_events e
      where e.resource_type='publication' and e.resource_id=d.publication_id and e.action='publication.delivery_retried'
       and e.metadata->>'delivery_id'=d.id::text))<late)
   order by pj.run_at,pj.id limit 50 for update of pj skip locked loop
  perform publications_private.block_delivery(j.delivery_id,'late_schedule');n:=n+1;
 end loop;
 -- Encore des retards à bloquer : rien n'est envoyé dans ce passage (le suivant continue).
 if n=50 then return null; end if;
 return public.publication_job_claim(p_worker_id,p_lease_seconds);
end $$;

-- 2. Réservation du planificateur limitée aux plateformes dont l'envoi tient dans le temps restant du passage.
-- p_platforms nul : comportement de publication_job_claim_on_time. Sinon, la réservation ordinaire (même ordre, mêmes
-- contrôles) est faite dans une sous-transaction ; si la tâche réservée est d'une autre plateforme, tout est annulé et
-- rien n'est réservé : la tâche reste en tête de file pour le passage suivant (jamais doublée par une plus rapide).
create function public.publication_job_claim_scheduled(p_worker_id text,p_lease_seconds integer,p_max_late_seconds integer,p_platforms text[]) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c jsonb;
begin
 if p_platforms is not null and (cardinality(p_platforms) not between 1 and 3 or exists(select 1 from unnest(p_platforms) x
   where x is null or x not in('facebook','instagram','google_business_profile'))) then raise exception 'Invalid claim' using errcode='22023'; end if;
 if p_platforms is null then return public.publication_job_claim_on_time(p_worker_id,p_lease_seconds,p_max_late_seconds); end if;
 begin
  c:=public.publication_job_claim_on_time(p_worker_id,p_lease_seconds,p_max_late_seconds);
  if c is not null and not (c->>'platform'=any(p_platforms)) then raise exception 'Deferred claim' using errcode='PD047'; end if;
  return c;
 exception when sqlstate 'PD047' then return null;
 end;
end $$;

revoke all on function public.publication_job_claim_on_time(text,integer,integer),public.publication_job_claim_scheduled(text,integer,integer,text[]) from public,anon,authenticated;
grant execute on function public.publication_job_claim_on_time(text,integer,integer),public.publication_job_claim_scheduled(text,integer,integer,text[]) to service_role;
notify pgrst, 'reload schema';
