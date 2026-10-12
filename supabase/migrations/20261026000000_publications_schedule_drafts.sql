-- Planification d'un brouillon non planifié (dépend de 20261025000000_publications_unscheduled_drafts.sql).
-- Migration additive : une seule fonction, aucune table ni ligne existante modifiée.
--
-- Le brouillon est rattaché à des occurrences OUVERTES du calendrier existant (une par plateforme de sa révision
-- actuelle) : la fréquence reste celle des créneaux de canal, une occurrence ne porte qu'une publication et aucune
-- publication existante n'est déplacée ni remplacée. Tout se fait dans une transaction : en cas d'échec, le brouillon
-- reste intact et récupérable.
--
-- Approbation : planifier fixe une date. Une nouvelle révision (mêmes textes, mêmes médias) est donc toujours créée
-- en brouillon ; toute approbation antérieure, liée à l'ancienne révision, ne vaut pas pour la publication planifiée.
-- Les revues restent dans l'historique.
--
-- - Brouillon mono-plateforme (toutes ses révisions sur la plateforme choisie) : rattachement sur place, même
--   publication et même historique (occurrence, plateforme et date fixées une fois, comme les liaisons existantes).
-- - Brouillon multi-plateforme : une publication planifiée par plateforme (règle existante « une publication par
--   occurrence et par plateforme »), regroupées dans un groupe éditorial, avec le texte, la source et les médias de la
--   variante ; le brouillon d'origine est archivé (consultable) et lié par son journal.
create function public.publication_schedule_draft(p_publication_id uuid,p_expected_revision_id uuid,p_assignments jsonb,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;rev public.publication_revisions;occ public.publication_channel_occurrences;item jsonb;
 platforms text[]:='{}';occurrences uuid[]:='{}';current_platforms text[];all_platforms text[];previous_status text;
 grp uuid;created uuid;revision uuid;variant jsonb;results jsonb:='[]'::jsonb;i integer;in_place boolean;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_expected_revision_id is null
  or jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 3 then
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
 in_place:=cardinality(platforms)=1 and all_platforms=platforms;

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
