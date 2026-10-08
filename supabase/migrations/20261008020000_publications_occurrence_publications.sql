-- Lot 4.3 P4-b: occurrence-driven mono-platform publications. Creation from an occurrence (with an optional new
-- or existing editorial group), explicit one-way skip of an occurrence, and the legacy weekly two-slot rule no
-- longer applied to occurrence-bound publications. Additive: no data converted, no publication/delivery/job
-- created by migration, no external call.

-- P4-a binding guard, extended: an occurrence-bound publication keeps the date and week of its occurrence.
create or replace function publications_private.guard_publication_binding() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare occurrence_date date;
begin
 if tg_op='UPDATE' and ((old.editorial_group_id is not null and new.editorial_group_id is distinct from old.editorial_group_id)
   or (old.occurrence_id is not null and new.occurrence_id is distinct from old.occurrence_id)
   or (old.platform is not null and new.platform is distinct from old.platform)) then
  raise exception 'Publication binding is immutable' using errcode='55000'; end if;
 if new.platform is not null and (tg_op='INSERT' or old.platform is null) and exists(select 1 from public.publication_variants v
   where v.publication_id=new.id and v.platform<>new.platform) then
  raise exception 'Mono-platform publication has other variants' using errcode='23514'; end if;
 if new.occurrence_id is not null then
  select local_date into occurrence_date from public.publication_channel_occurrences where id=new.occurrence_id;
  if occurrence_date is not null and (new.target_date is distinct from occurrence_date
    or new.editorial_week<>(date_trunc('week',occurrence_date::timestamp))::date) then
   raise exception 'Occurrence-bound publication keeps the occurrence date' using errcode='23514'; end if;
 end if;
 return new;
end $$;

-- Atomic creation of ONE mono-platform draft publication from ONE open occurrence.
-- Group: p_editorial_group_id (existing group of the same client/project) or p_new_group_subject (new group), or none.
-- Client, project and platform always come from the occurrence. Exactly one variant, on the occurrence platform.
create function public.publication_create_from_occurrence(p_occurrence_id uuid,p_editorial_group_id uuid,p_new_group_subject text,
 p_subject text,p_text_content text,p_metadata jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare occ public.publication_channel_occurrences;grp public.publication_editorial_groups;group_created boolean:=false;
 publication uuid;revision uuid;subject text:=btrim(p_subject);content text:=btrim(p_text_content);new_group text:=nullif(btrim(p_new_group_subject),'');
 metadata jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_occurrence_id is null
  or subject is null or length(subject) not between 1 and 300 or subject ~ '[\x00-\x1f]'
  or content is null or length(content) not between 1 and 10000
  or (p_editorial_group_id is not null and new_group is not null)
  or (new_group is not null and (length(new_group)>300 or new_group ~ '[\x00-\x1f]'))
  or not publications_private.safe_metadata(metadata) then
  raise exception 'Invalid publication' using errcode='22023'; end if;
 -- Lock the occurrence: serializes creation and skip on the same occurrence.
 select * into occ from public.publication_channel_occurrences where id=p_occurrence_id for update;
 if not found then raise exception 'Invalid occurrence' using errcode='23514'; end if;
 if occ.skipped_at is not null then raise exception 'Occurrence skipped' using errcode='23514'; end if;
 if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23505'; end if;
 if p_editorial_group_id is not null then
  select * into grp from public.publication_editorial_groups where id=p_editorial_group_id for update;
  if not found or grp.client_id<>occ.client_id or grp.project_id<>occ.project_id then
   raise exception 'Editorial group outside the occurrence project' using errcode='23514'; end if;
 elsif new_group is not null then
  insert into public.publication_editorial_groups(client_id,project_id,subject,origin) values(occ.client_id,occ.project_id,new_group,'manual') returning * into grp;
  group_created:=true;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.editorial_group_created',occ.client_id,'editorial_group',grp.id,
   jsonb_build_object('project_id',occ.project_id,'editorial_group_id',grp.id,'occurrence_id',occ.id));
 end if;
 insert into public.publications(client_id,project_id,editorial_week,slot,subject,target_date,platform,occurrence_id,editorial_group_id,creation_origin)
 values(occ.client_id,occ.project_id,(date_trunc('week',occ.local_date::timestamp))::date,1,subject,occ.local_date,occ.platform,occ.id,grp.id,'manual')
 returning id into publication;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',subject,'angle',subject,'source',content,'target_date',occ.local_date,
  'actor',p_actor_id,'project',occ.project_id)::text,true);
 revision:=publications_private.add_manual_revision(publication,occ.client_id,null,
  jsonb_build_array(jsonb_build_object('platform',occ.platform,'text_content',content,'metadata',metadata)));
 perform set_config('codev.publication_editorial','',true);
 update public.publications set current_revision_id=revision where id=publication;
 if (select count(*) from public.publication_variants where revision_id=revision)<>1
  or (select publication_id from public.publication_channel_occurrences where id=occ.id) is distinct from publication then
  raise exception 'Occurrence publication invariant' using errcode='P0001'; end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.created_from_occurrence',occ.client_id,'publication',publication,
  jsonb_build_object('project_id',occ.project_id,'occurrence_id',occ.id,'publication_id',publication,'platform',occ.platform,
   'editorial_group_id',grp.id,'editorial_group_created',group_created,'revision_id',revision));
 return jsonb_build_object('publication_id',publication,'revision_id',revision,'editorial_group_id',grp.id,'editorial_group_created',group_created);
end $$;

-- Explicit, one-way skip of an open occurrence (never linked, never deleted). The reason is stored on the
-- occurrence only; the audit records facts, not the free text.
create function public.publication_occurrence_skip(p_occurrence_id uuid,p_reason text,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare occ public.publication_channel_occurrences;reason text:=btrim(p_reason);
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_occurrence_id is null
  or reason is null or length(reason) not between 1 and 500 or reason ~ '[\x00-\x1f]' then
  raise exception 'Invalid skip' using errcode='22023'; end if;
 select * into occ from public.publication_channel_occurrences where id=p_occurrence_id for update;
 if not found then raise exception 'Invalid occurrence' using errcode='23514'; end if;
 if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23514'; end if;
 if occ.skipped_at is not null then raise exception 'Occurrence already skipped' using errcode='55000'; end if;
 update public.publication_channel_occurrences set skipped_at=now(),skipped_reason=reason where id=occ.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.occurrence_skipped',occ.client_id,'project_channel_occurrence',occ.id,
  jsonb_build_object('project_id',occ.project_id,'occurrence_id',occ.id,'platform',occ.platform,'local_date',occ.local_date));
 return occ.id;
end $$;

-- Legacy manual allocator: byte-identical to the Lot 3 definition except that occurrence-bound publications no
-- longer occupy the historical weekly slots 1/2 (they follow their channel schedules). Legacy behaviour unchanged.
create or replace function public.publication_save_draft(p_publication_id uuid,p_expected_revision_id uuid,p_client_id uuid,p_project_id uuid,p_title text,p_angle text,p_source text,p_target_date date,p_week date,p_slot smallint,p_variants jsonb,p_actor_id text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;saved_id uuid;revision uuid;slot smallint;week date;old_project uuid;old_revision uuid;item public.publication_variants;asset uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or coalesce(length(btrim(p_title)),0) not between 1 and 300 or coalesce(length(btrim(p_angle)),0) not between 1 and 3000 or coalesce(length(btrim(p_source)),0) not between 1 and 20000 then raise exception 'Invalid draft' using errcode='22023';end if;
 if p_project_id is null or not exists(select 1 from public.projects where projects.id=p_project_id and client_id=p_client_id and type in('Réseaux sociaux','Google Business Profile')) then raise exception 'Invalid client/project' using errcode='23514';end if;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',btrim(p_title),'angle',btrim(p_angle),'source',btrim(p_source),'target_date',p_target_date,'actor',p_actor_id,'project',p_project_id)::text,true);
 if p_publication_id is null then
  week:=coalesce(p_week,date_trunc('week',coalesce(p_target_date,current_date)::timestamp)::date);
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text||week::text,0));
  slot:=p_slot;
  if slot is null then select s::smallint into slot from generate_series(1,2) s where not exists(select 1 from public.publications where client_id=p_client_id and project_id=p_project_id and editorial_week=week and publications.slot=s and publications.occurrence_id is null)
   and not exists(select 1 from public.publication_calendar_slots c where c.project_id=p_project_id and c.editorial_week=week and c.slot=s and p_target_date is not null and p_target_date<>c.local_date) order by s limit 1;end if;
  if slot is null then raise exception 'Both editorial slots occupied' using errcode='23505';end if;
  saved_id:=public.publication_create_project_manual(p_client_id,p_project_id,week,slot,p_title,p_variants,p_actor_id);
 else
  select * into pub from public.publications where publications.id=p_publication_id for update;
  if not found or pub.client_id<>p_client_id or pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale draft' using errcode='40001';end if;
  old_project:=pub.project_id;
  old_revision:=pub.current_revision_id;
  perform set_config('codev.publication_actor',p_actor_id,true);
  if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status in('processing','published','uncertain')) then raise exception 'Resolve deliveries first' using errcode='55000';end if;
  revision:=publications_private.add_manual_revision(pub.id,pub.client_id,pub.current_revision_id,p_variants);
  update public.publication_deliveries set status='blocked' where publication_id=pub.id and status<>'cancelled';
  update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null where publication_id=pub.id and status in('pending','processing');
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
   values('admin',p_actor_id,'publication.revised',p_client_id,'publication',pub.id,jsonb_build_object('revision_id',pub.current_revision_id),jsonb_build_object('revision_id',revision,'status','draft'));
  saved_id:=pub.id;
  if old_project is distinct from p_project_id then
   insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
   values('admin',p_actor_id,'publication.project_changed',p_client_id,'publication',saved_id,jsonb_build_object('project_id',old_project),jsonb_build_object('project_id',p_project_id,'revision_id',revision));
  end if;
 end if;
 update public.publications set subject=btrim(p_title),target_date=p_target_date,status='draft',project_id=p_project_id,current_revision_id=coalesce(revision,current_revision_id) where publications.id=saved_id;
 select current_revision_id into revision from public.publications where publications.id=saved_id;
 for item in select * from public.publication_variants where revision_id=revision loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.variant_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'variant_id',item.id,'platform',item.platform));
 end loop;
 for asset in select distinct l.asset_id from public.publication_variant_assets l join public.publication_variants v on v.id=l.variant_id where v.revision_id=revision loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.media_attached',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'asset_id',asset));
 end loop;
 for asset in select distinct l.asset_id from public.publication_variant_assets l join public.publication_variants v on v.id=l.variant_id where v.revision_id=old_revision
  and not exists(select 1 from public.publication_variant_assets ll join public.publication_variants vv on vv.id=ll.variant_id where vv.revision_id=revision and ll.asset_id=l.asset_id) loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.media_detached',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'asset_id',asset));
 end loop;
 perform set_config('codev.publication_editorial','',true);
 perform set_config('codev.publication_actor','',true);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.draft_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',(select current_revision_id from public.publications where publications.id=saved_id)));
 return saved_id;
end $$;

revoke all on function public.publication_create_from_occurrence(uuid,uuid,text,text,text,jsonb,text),public.publication_occurrence_skip(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.publication_create_from_occurrence(uuid,uuid,text,text,text,jsonb,text),public.publication_occurrence_skip(uuid,text,text)
 to service_role;
