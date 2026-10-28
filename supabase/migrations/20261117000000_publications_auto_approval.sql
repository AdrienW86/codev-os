-- Validation automatique par défaut d'accord (« silence vaut accord ») : une publication préparée par l'agent et placée
-- « À valider » est approuvée automatiquement N heures avant son créneau si personne n'a agi, au nom de l'administrateur
-- qui a délégué la préparation automatique du client. Garde-fous, revérifiés en base au moment d'approuver :
--  - le client a activé la validation automatique (désactivée par défaut) ;
--  - la révision courante vient de l'agent (« generated ») : une modification humaine crée une révision « manual »
--    qui repasse en validation manuelle ;
--  - jamais TikTok (TikTok impose un choix humain de la confidentialité et un consentement à chaque publication) ;
--  - créneau à venir, dans la fenêtre choisie, canal du projet actif ;
--  - l'invariant média de la base s'applique toujours (aucune approbation sans photo).
alter table public.publication_client_settings
 add column if not exists auto_approve_enabled boolean not null default false,
 add column if not exists auto_approve_hours_before smallint not null default 12;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='publication_client_settings_auto_approve_hours_check') then
  alter table public.publication_client_settings add constraint publication_client_settings_auto_approve_hours_check
   check (auto_approve_hours_before between 1 and 72);
 end if;
end $$;

-- Réglage par client (journalisé).
create or replace function public.publication_auto_approval_save(p_client_id uuid, p_enabled boolean, p_hours_before integer, p_actor_id text)
returns void language plpgsql set search_path to 'pg_catalog' as $$
declare previous public.publication_client_settings;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_client_id is null or p_enabled is null
  or p_hours_before is null or p_hours_before not between 1 and 72 then
  raise exception 'Invalid auto approval settings' using errcode='22023'; end if;
 select * into previous from public.publication_client_settings where client_id=p_client_id for update;
 if not found then raise exception 'Client settings missing' using errcode='23514'; end if;
 update public.publication_client_settings set auto_approve_enabled=p_enabled,auto_approve_hours_before=p_hours_before where client_id=p_client_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
 values('admin',p_actor_id,'publication.auto_approval_saved',p_client_id,'client',p_client_id,
  jsonb_build_object('auto_approve_enabled',previous.auto_approve_enabled,'auto_approve_hours_before',previous.auto_approve_hours_before),
  jsonb_build_object('auto_approve_enabled',p_enabled,'auto_approve_hours_before',p_hours_before),'{}'::jsonb);
end $$;

-- Éligibilité d'une publication à la validation automatique à l'instant p_now (même règle pour la liste et l'approbation).
create or replace function publications_private.auto_approval_eligible(p_publication_id uuid, p_now timestamptz)
returns boolean language sql stable set search_path to 'pg_catalog' as $$
 select exists(
  select 1 from public.publications p
  join public.publication_client_settings s on s.client_id=p.client_id and s.auto_approve_enabled
  join public.publication_channel_occurrences o on o.id=p.occurrence_id and o.publication_id=p.id and o.skipped_at is null
  join public.publication_revisions r on r.id=p.current_revision_id and r.publication_id=p.id
  join public.publication_project_channels c on c.project_id=p.project_id and c.platform=p.platform and c.enabled
  where p.id=p_publication_id and p.status='pending_review' and p.archived_at is null
   and p.platform is not null and p.platform<>'tiktok' and r.origin='generated'
   and o.scheduled_for>p_now and o.scheduled_for<=p_now+make_interval(hours=>s.auto_approve_hours_before));
$$;

create or replace function public.publication_auto_approval_candidates(p_now timestamptz, p_limit integer)
returns table(publication_id uuid, revision_id uuid, client_id uuid, scheduled_for timestamptz)
language sql stable set search_path to 'pg_catalog' as $$
 select p.id,p.current_revision_id,p.client_id,o.scheduled_for
 from public.publications p join public.publication_channel_occurrences o on o.id=p.occurrence_id
 where p.status='pending_review' and p.archived_at is null and p_now is not null
  and publications_private.auto_approval_eligible(p.id,p_now)
 order by o.scheduled_for,p.id
 limit least(greatest(coalesce(p_limit,0),1),50);
$$;

-- Approbation automatique : revérifie l'éligibilité sous verrou, puis la même décision qu'un humain (révision entière),
-- au nom de l'administrateur délégué, et trace qu'elle est automatique.
create or replace function public.publication_auto_approve(p_publication_id uuid, p_revision_id uuid, p_actor_id text)
returns void language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_revision_id is null then
  raise exception 'Invalid auto approval' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.current_revision_id is distinct from p_revision_id then raise exception 'Stale auto approval' using errcode='40001'; end if;
 if not publications_private.auto_approval_eligible(p_publication_id,now()) then raise exception 'Not eligible for auto approval' using errcode='55000'; end if;
 perform public.publication_review_manual(p_publication_id,p_revision_id,'approved',null,p_actor_id);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('system',null,'publication.auto_approved',pub.client_id,'publication',pub.id,
  jsonb_build_object('revision_id',p_revision_id,'delegated_actor',p_actor_id,'platform',pub.platform));
end $$;

revoke all on function public.publication_auto_approval_save(uuid,boolean,integer,text) from public, anon, authenticated;
revoke all on function public.publication_auto_approval_candidates(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.publication_auto_approve(uuid,uuid,text) from public, anon, authenticated;
revoke all on function publications_private.auto_approval_eligible(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.publication_auto_approval_save(uuid,boolean,integer,text) to service_role;
grant execute on function public.publication_auto_approval_candidates(timestamptz,integer) to service_role;
grant execute on function public.publication_auto_approve(uuid,uuid,text) to service_role;
grant execute on function publications_private.auto_approval_eligible(uuid,timestamptz) to service_role;
