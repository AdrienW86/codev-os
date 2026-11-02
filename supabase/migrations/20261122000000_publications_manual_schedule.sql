-- Publication manuelle à tout moment (hors créneaux du planning).
-- Un brouillon non planifié peut être programmé à une date et une heure libres, ou « maintenant » (minute suivante).
-- Principe : une occurrence MANUELLE (sans créneau hebdomadaire) est créée pour chaque plateforme du brouillon, puis
-- le brouillon y est rattaché par la RPC existante publication_schedule_draft. Tout l'aval est inchangé et s'applique
-- tel quel : validation humaine, préparation de la diffusion par le planificateur, tolérance de retard, calendrier.
-- Additif : aucune donnée existante n'est modifiée ; les occurrences existantes deviennent origin='schedule'.

-- 1. Occurrences manuelles : pas de créneau ni de planning, mais toujours le canal du projet (clé étrangère inchangée).
alter table public.publication_channel_occurrences add column origin text not null default 'schedule';
alter table public.publication_channel_occurrences add constraint publication_channel_occurrences_origin_check check(origin in('schedule','manual'));
alter table public.publication_channel_occurrences alter column schedule_id drop not null, alter column schedule_slot_id drop not null;
alter table public.publication_channel_occurrences add constraint publication_channel_occurrences_origin_slot check(
 (origin='schedule' and schedule_id is not null and schedule_slot_id is not null) or (origin='manual' and schedule_id is null and schedule_slot_id is null));

-- 2. Création : une occurrence de planning correspond toujours à son créneau ; une occurrence manuelle est à venir.
create or replace function publications_private.guard_channel_occurrence_insert() returns trigger
language plpgsql set search_path to 'pg_catalog' as $$
declare s public.publication_channel_schedule_slots;h public.publication_channel_schedules;instant timestamptz;
begin
 if new.origin='manual' then
  if new.schedule_id is not null or new.schedule_slot_id is not null then raise exception 'Manual occurrence has no schedule slot' using errcode='23514'; end if;
  if new.scheduled_for<=now() then raise exception 'Manual occurrence in the past' using errcode='23514'; end if;
 else
  select * into s from public.publication_channel_schedule_slots where id=new.schedule_slot_id;
  select * into h from public.publication_channel_schedules where id=new.schedule_id;
  if s.id is null or h.id is null or extract(isodow from new.local_date)<>s.weekday or new.local_time<>s.local_time or new.timezone<>h.timezone then
   raise exception 'Occurrence does not match its schedule slot' using errcode='23514'; end if;
 end if;
 instant:=publications_private.local_schedule_instant(new.local_date,new.local_time,new.timezone);
 if instant is null or new.scheduled_for<>instant then raise exception 'Occurrence instant invalid' using errcode='23514'; end if;
 if new.publication_id is not null or new.skipped_at is not null then raise exception 'Occurrence must be created open' using errcode='23514'; end if;
 return new;
end $$;

-- 3. L'origine fait partie de l'instantané immuable (reste identique à la version du 14/11).
create or replace function publications_private.guard_channel_occurrence_update()
returns trigger language plpgsql set search_path to 'pg_catalog' as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.schedule_id,new.schedule_slot_id,new.platform,new.local_date,new.local_time,new.timezone,new.scheduled_for,new.created_at,new.origin)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.schedule_id,old.schedule_slot_id,old.platform,old.local_date,old.local_time,old.timezone,old.scheduled_for,old.created_at,old.origin) then
  raise exception 'Occurrence snapshot is immutable' using errcode='55000'; end if;
 if old.publication_id is not null and new.publication_id is distinct from old.publication_id then
  if new.publication_id is null and exists(select 1 from public.publications p where p.id=old.publication_id and p.archived_at is not null)
   and not exists(select 1 from public.publication_deliveries d where d.publication_id=old.publication_id and d.status in ('published','simulated','uncertain','processing')) then
   null;
  else raise exception 'Occurrence publication is immutable' using errcode='55000'; end if;
 end if;
 if old.skipped_at is not null and (new.skipped_at,new.skipped_reason) is distinct from (old.skipped_at,old.skipped_reason) then raise exception 'Occurrence skip is immutable' using errcode='55000'; end if;
 if old.publication_id is null and new.publication_id is not null and not exists(select 1 from public.publications p
   where p.id=new.publication_id and p.client_id=new.client_id and p.project_id=new.project_id and p.occurrence_id=new.id and p.archived_at is null) then
  raise exception 'Occurrence publication outside its project' using errcode='23514'; end if;
 return new;
end $$;

-- 4. Retirer une publication manuelle jamais diffusée ne rend pas son horaire disponible à l'agent : l'occurrence
--    manuelle est détachée ET ignorée (elle n'existait que pour cette publication). Le reste est inchangé.
create or replace function public.publication_remove(p_publication_id uuid, p_actor_id text)
returns integer language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications; cancelled integer := 0; released boolean := false;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null then
  raise exception 'Invalid removal' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.archived_at is not null then raise exception 'Publication already archived' using errcode='55000'; end if;
 perform 1 from public.publication_deliveries where publication_id=pub.id for update;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status='processing') then
  raise exception 'Delivery in progress' using errcode='55000'; end if;
 update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null
  where type='deliver' and status='pending' and delivery_id in (select id from public.publication_deliveries where publication_id=pub.id and status in ('scheduled','retryable_error','blocked'));
 with c as (update public.publication_deliveries set status='cancelled'
  where publication_id=pub.id and status in ('scheduled','retryable_error','blocked') returning 1)
 select count(*) into cancelled from c;
 update public.publications set archived_at=now(),archived_by=p_actor_id where id=pub.id;
 if pub.occurrence_id is not null and not exists(select 1 from public.publication_deliveries d where d.publication_id=pub.id and d.status in ('published','simulated','uncertain')) then
  if (select origin from public.publication_channel_occurrences where id=pub.occurrence_id)='manual' then
   update public.publication_channel_occurrences set publication_id=null,skipped_at=now(),skipped_reason='Publication manuelle retirée'
    where id=pub.occurrence_id and publication_id=pub.id;
  else
   update public.publication_channel_occurrences set publication_id=null
    where id=pub.occurrence_id and publication_id=pub.id and scheduled_for>now();
   released := found;
  end if;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.archived',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'publication_id',pub.id,'platform',pub.platform,'occurrence_id',pub.occurrence_id,
   'editorial_group_id',pub.editorial_group_id,'status',pub.status,'cancelled_deliveries',cancelled,'released_occurrence',released,'mode','remove_any_state'));
 return cancelled;
end $$;
revoke all on function public.publication_remove(uuid,text) from public, anon, authenticated;
grant execute on function public.publication_remove(uuid,text) to service_role;

-- 5. Brouillons et planification : jusqu'à 5 plateformes (Facebook, Instagram, Google, TikTok, Snapchat) au lieu de 3,
--    pour qu'un même post puisse partir sur tous les réseaux d'un projet. Seule la borne change dans les deux fonctions,
--    plus un correctif : la planification « sur place » n'est utilisée que si le créneau est dans la semaine éditoriale
--    du brouillon (immuable) ; sinon une nouvelle publication est créée sur le créneau et le brouillon archivé, comme
--    pour plusieurs plateformes (avant : refus « Occurrence-bound publication keeps the occurrence date »).
create or replace function publications_private.add_manual_revision(p_publication_id uuid, p_client_id uuid, p_parent_id uuid, p_variants jsonb)
returns uuid language plpgsql set search_path to 'pg_catalog' as $$
declare revision uuid;item jsonb;variant uuid;asset jsonb;position integer;
begin
 if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 5 then raise exception 'Invalid variants' using errcode='22023';end if;
 insert into public.publication_revisions(publication_id,client_id,revision_number,parent_revision_id,origin)
 values(p_publication_id,p_client_id,coalesce((select max(revision_number) from public.publication_revisions where publication_id=p_publication_id),0)+1,p_parent_id,'manual') returning id into revision;
 for item in select value from jsonb_array_elements(p_variants) loop
  if jsonb_typeof(item)<>'object' or item-'platform'-'text_content'-'asset_ids'-'metadata'<>'{}'::jsonb
   or jsonb_typeof(item->'platform') is distinct from 'string' or jsonb_typeof(item->'text_content') is distinct from 'string'
   or(item ? 'asset_ids' and jsonb_typeof(item->'asset_ids')<>'array') then raise exception 'Invalid variant' using errcode='22023';end if;
  insert into public.publication_variants(revision_id,publication_id,client_id,platform,text_content,metadata)
   values(revision,p_publication_id,p_client_id,item->>'platform',item->>'text_content',coalesce(item->'metadata','{}')) returning id into variant;
  position:=0;
  for asset in select value from jsonb_array_elements(coalesce(item->'asset_ids','[]')) loop
   if jsonb_typeof(asset)<>'string' or position>=10 then raise exception 'Invalid assets' using errcode='22023';end if;
   insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(variant,(asset #>> '{}')::uuid,p_client_id,position);
   position:=position+1;
  end loop;
 end loop;
 return revision;
end $$;
create or replace function public.publication_schedule_draft(p_publication_id uuid,p_expected_revision_id uuid,p_assignments jsonb,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;rev public.publication_revisions;occ public.publication_channel_occurrences;item jsonb;
 platforms text[]:='{}';occurrences uuid[]:='{}';current_platforms text[];all_platforms text[];previous_status text;
 grp uuid;created uuid;revision uuid;variant jsonb;results jsonb:='[]'::jsonb;i integer;in_place boolean;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_expected_revision_id is null
  or jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 5 then
  raise exception 'Invalid schedule' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assignments) loop
  if jsonb_typeof(item)<>'object' or item-'platform'-'occurrence_id'<>'{}'::jsonb
   or jsonb_typeof(item->'platform') is distinct from 'string' or jsonb_typeof(item->'occurrence_id') is distinct from 'string'
   or (item->>'occurrence_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (item->>'platform')=any(platforms) or (item->>'occurrence_id')::uuid=any(occurrences) then
   raise exception 'Invalid schedule' using errcode='22023'; end if;
  platforms:=platforms||(item->>'platform');occurrences:=occurrences||(item->>'occurrence_id')::uuid;
 end loop;

 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale draft' using errcode='40001'; end if;
 if pub.archived_at is not null then raise exception 'Archived publication' using errcode='55000'; end if;
 if pub.slot is not null or pub.occurrence_id is not null or pub.editorial_group_id is not null or pub.project_id is null then
  raise exception 'Publication already scheduled' using errcode='55000'; end if;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status<>'cancelled') then
  raise exception 'Resolve deliveries first' using errcode='55000'; end if;
 select * into rev from public.publication_revisions where id=pub.current_revision_id;
 -- Exactement une occurrence par plateforme de la révision actuelle : aucune variante n'est laissée de côté.
 select array_agg(platform order by platform) into current_platforms from public.publication_variants where revision_id=pub.current_revision_id;
 if current_platforms is null or current_platforms<>(select array_agg(p order by p) from unnest(platforms) p) then
  raise exception 'Every draft platform needs one occurrence' using errcode='23514'; end if;

 -- Occurrences verrouillées dans un ordre stable, puis vérifiées : même client et projet, même plateforme, libres,
 -- non ignorées et à venir.
 perform 1 from public.publication_channel_occurrences where id=any(occurrences) order by id for update;
 for i in 1..cardinality(occurrences) loop
  select * into occ from public.publication_channel_occurrences where id=occurrences[i];
  if not found or occ.client_id<>pub.client_id or occ.project_id<>pub.project_id or occ.platform<>platforms[i] then
   raise exception 'Invalid occurrence' using errcode='23514'; end if;
  if occ.skipped_at is not null then raise exception 'Occurrence skipped' using errcode='23514'; end if;
  if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23505'; end if;
  if occ.scheduled_for<=now() then raise exception 'Occurrence in the past' using errcode='23514'; end if;
 end loop;

 previous_status:=pub.status;
 select array_agg(distinct platform) into all_platforms from public.publication_variants where publication_id=pub.id;
 in_place:=cardinality(platforms)=1 and all_platforms=platforms and pub.editorial_week is not distinct from
  (select (date_trunc('week',o.local_date::timestamp))::date from public.publication_channel_occurrences o where o.id=occurrences[1]);

 if in_place then
  select * into occ from public.publication_channel_occurrences where id=occurrences[1];
  select jsonb_agg(jsonb_build_object('platform',v.platform,'text_content',v.text_content,'metadata',v.metadata,
    'asset_ids',coalesce((select jsonb_agg(va.asset_id order by va.sort_order) from public.publication_variant_assets va where va.variant_id=v.id),'[]'::jsonb)))
   into variant from public.publication_variants v where v.revision_id=pub.current_revision_id;
  perform set_config('codev.publication_editorial',jsonb_build_object('title',pub.subject,'angle',rev.angle,'source',rev.source_content,
   'target_date',occ.local_date,'actor',p_actor_id,'project',pub.project_id)::text,true);
  revision:=publications_private.add_manual_revision(pub.id,pub.client_id,pub.current_revision_id,variant);
  update public.publications set current_revision_id=revision,target_date=occ.local_date,status='draft',platform=occ.platform,occurrence_id=occ.id
   where id=pub.id;
  perform set_config('codev.publication_editorial','',true);
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
  values('admin',p_actor_id,'publication.revised',pub.client_id,'publication',pub.id,jsonb_build_object('revision_id',pub.current_revision_id),
   jsonb_build_object('revision_id',revision,'status','draft'));
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.scheduled',pub.client_id,'publication',pub.id,jsonb_build_object('occurrence_id',occ.id,'platform',occ.platform,
   'target_date',occ.local_date,'revision_id',revision,'previous_revision_id',pub.current_revision_id,'previous_status',previous_status,
   'approval_reset',previous_status<>'draft'));
  results:=jsonb_build_array(jsonb_build_object('publication_id',pub.id,'platform',occ.platform,'occurrence_id',occ.id,'revision_id',revision));
  return jsonb_build_object('mode','in_place','publications',results,'editorial_group_id',null,'archived_source_id',null);
 end if;

 if cardinality(platforms)>1 then
  insert into public.publication_editorial_groups(client_id,project_id,subject,origin) values(pub.client_id,pub.project_id,pub.subject,'manual') returning id into grp;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.editorial_group_created',pub.client_id,'editorial_group',grp,
   jsonb_build_object('project_id',pub.project_id,'editorial_group_id',grp,'source_publication_id',pub.id));
 end if;
 for i in 1..cardinality(occurrences) loop
  select * into occ from public.publication_channel_occurrences where id=occurrences[i];
  select jsonb_build_object('platform',v.platform,'text_content',v.text_content,'metadata',v.metadata,
    'asset_ids',coalesce((select jsonb_agg(va.asset_id order by va.sort_order) from public.publication_variant_assets va where va.variant_id=v.id),'[]'::jsonb))
   into variant from public.publication_variants v where v.revision_id=pub.current_revision_id and v.platform=occ.platform;
  -- Même forme qu'une publication créée depuis une occurrence (semaine de l'occurrence ; le créneau 1 est hors de
  -- l'index des créneaux hebdomadaires pour les publications liées à une occurrence).
  insert into public.publications(client_id,project_id,editorial_week,slot,subject,target_date,platform,occurrence_id,editorial_group_id,creation_origin)
  values(pub.client_id,pub.project_id,(date_trunc('week',occ.local_date::timestamp))::date,1,pub.subject,occ.local_date,occ.platform,occ.id,grp,'manual')
  returning id into created;
  perform set_config('codev.publication_editorial',jsonb_build_object('title',pub.subject,'angle',rev.angle,'source',rev.source_content,
   'target_date',occ.local_date,'actor',p_actor_id,'project',pub.project_id,'origin','manual')::text,true);
  revision:=publications_private.add_manual_revision(created,pub.client_id,null,jsonb_build_array(variant));
  perform set_config('codev.publication_editorial','',true);
  update public.publications set current_revision_id=revision where id=created;
  if (select publication_id from public.publication_channel_occurrences where id=occ.id) is distinct from created then
   raise exception 'Occurrence publication invariant' using errcode='P0001'; end if;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.created_from_occurrence',pub.client_id,'publication',created,
   jsonb_build_object('project_id',pub.project_id,'occurrence_id',occ.id,'publication_id',created,'platform',occ.platform,
    'editorial_group_id',grp,'editorial_group_created',grp is not null and i=1,'revision_id',revision,'source_publication_id',pub.id,'source_revision_id',pub.current_revision_id));
  results:=results||jsonb_build_object('publication_id',created,'platform',occ.platform,'occurrence_id',occ.id,'revision_id',revision);
 end loop;
 perform public.publication_archive(pub.id,p_actor_id);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.scheduled_split',pub.client_id,'publication',pub.id,jsonb_build_object('revision_id',pub.current_revision_id,
  'previous_status',previous_status,'editorial_group_id',grp,'publications',results));
 return jsonb_build_object('mode','split','publications',results,'editorial_group_id',grp,'archived_source_id',pub.id);
end $$;
revoke all on function public.publication_schedule_draft(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_schedule_draft(uuid,uuid,jsonb,text) to service_role;

-- 6. Programmation libre d'un brouillon non planifié : une occurrence manuelle par plateforme de la révision courante,
--    à l'instant demandé (arrondi à la minute ; au plus tôt la minute suivante, au plus tard dans 12 semaines), dans le
--    fuseau du planning du canal (sinon celui du client, sinon Paris), puis rattachement par publication_schedule_draft.
--    Une seule transaction : en cas de refus, aucune occurrence ne subsiste.
create function public.publication_schedule_manual(p_publication_id uuid,p_expected_revision_id uuid,p_at timestamptz,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;ch public.publication_project_channels;plat text;tz text;at timestamptz;local_at timestamp;occ uuid;
 assignments jsonb:='[]'::jsonb;result jsonb;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_expected_revision_id is null or p_at is null then
  raise exception 'Invalid manual schedule' using errcode='22023'; end if;
 if p_at<now()-interval '5 minutes' then raise exception 'Manual date in the past' using errcode='22023'; end if;
 at:=greatest(date_trunc('minute',p_at),date_trunc('minute',now())+interval '1 minute');
 if at>now()+interval '84 days' then raise exception 'Manual date too far' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale draft' using errcode='40001'; end if;
 if pub.archived_at is not null then raise exception 'Archived publication' using errcode='55000'; end if;
 if pub.slot is not null or pub.occurrence_id is not null or pub.editorial_group_id is not null or pub.project_id is null then
  raise exception 'Publication already scheduled' using errcode='55000'; end if;
 for plat in select distinct v.platform from public.publication_variants v where v.revision_id=pub.current_revision_id order by v.platform loop
  select * into ch from public.publication_project_channels where project_id=pub.project_id and client_id=pub.client_id and platform=plat;
  if not found or not ch.enabled then raise exception 'Channel not enabled: %',plat using errcode='23514'; end if;
  tz:=coalesce((select h.timezone from public.publication_channel_schedules h where h.project_channel_id=ch.id and h.client_id=ch.client_id limit 1),
   (select s.timezone from public.publication_client_settings s where s.client_id=pub.client_id),'Europe/Paris');
  local_at:=at at time zone tz;
  -- Heure locale ambiguë (passage à l'heure d'hiver) : l'instant retenu est celui que la base sait reconstruire.
  if publications_private.local_schedule_instant(local_at::date,local_at::time,tz) is distinct from at then
   raise exception 'Ambiguous local time' using errcode='22023'; end if;
  insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,platform,local_date,local_time,timezone,scheduled_for,origin)
  values(pub.client_id,pub.project_id,ch.id,plat,local_at::date,local_at::time,tz,at,'manual') returning id into occ;
  assignments:=assignments||jsonb_build_object('platform',plat,'occurrence_id',occ);
 end loop;
 if jsonb_array_length(assignments)=0 then raise exception 'Draft without platform' using errcode='23514'; end if;
 result:=public.publication_schedule_draft(pub.id,p_expected_revision_id,assignments,p_actor_id);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.manual_scheduled',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'scheduled_for',at,'requested_for',p_at,'publications',result->'publications'));
 return result||jsonb_build_object('scheduled_for',at);
end $$;
revoke all on function public.publication_schedule_manual(uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.publication_schedule_manual(uuid,uuid,timestamptz,text) to service_role;
notify pgrst, 'reload schema';
