-- Lot 2: manual drafts only. No settings, agents, jobs, cron or external calls.
alter table public.publications add column target_date date;
alter table public.publication_revisions add column internal_title text check(length(internal_title) between 1 and 300);
alter table public.publication_revisions add column angle text check(length(angle) between 1 and 3000);
alter table public.publication_revisions add column source_content text check(length(source_content) between 1 and 20000);
alter table public.publication_revisions add column target_date date;
alter table public.publication_revisions add column actor_id text check(actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$');
create or replace function publications_private.check_publication_state() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and (new.client_id, new.editorial_week, new.slot)
    is distinct from (old.client_id, old.editorial_week, old.slot) then
    raise exception 'Editorial identity is immutable' using errcode = '55000';
  end if;
  if tg_op='UPDATE' and (new.subject,new.target_date) is distinct from (old.subject,old.target_date) and
    (nullif(current_setting('codev.publication_editorial',true),'') is null or not exists(
      select 1 from public.publication_revisions r where r.id=new.current_revision_id
       and r.internal_title=new.subject and r.target_date is not distinct from new.target_date)) then
    raise exception 'Editorial changes require an audited new revision' using errcode='55000';
  end if;
  if new.status <> 'draft' and not exists (
    select 1 from public.publication_variants where revision_id = new.current_revision_id
  ) then raise exception 'A submitted revision needs variants' using errcode = '23514'; end if;
  if new.status = 'approved' and exists (
    select 1 from public.publication_variants v where v.revision_id = new.current_revision_id
      and not exists (select 1 from public.publication_reviews r where r.variant_id = v.id and r.decision = 'approved')
  ) then raise exception 'Current revision is not approved' using errcode = '23514'; end if;
  if new.status = 'rejected' and not exists (
    select 1 from public.publication_reviews where revision_id = new.current_revision_id and decision = 'rejected'
  ) then raise exception 'Missing rejection' using errcode = '23514'; end if;
  return new;
end;
$$;
create or replace function publications_private.safe_metadata(value jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(value)='object' and not exists(select 1 from jsonb_each(value) e
 where e.key not in('label','locale','account_name','alt_text','title','cta') or jsonb_typeof(e.value)<>'string' or length(e.value #>> '{}')>500),false);
$$;

-- Add editorial snapshots at INSERT time: immutable history is never updated.
create function publications_private.editorial_snapshot() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare value jsonb;
begin
 value:=nullif(current_setting('codev.publication_editorial',true),'')::jsonb;
 if value is not null then
  new.internal_title:=value->>'title';new.angle:=value->>'angle';new.source_content:=value->>'source';
  new.target_date:=nullif(value->>'target_date','')::date;new.actor_id:=value->>'actor';
  new.project_id:=(value->>'project')::uuid;
 elsif new.parent_revision_id is not null then
  select internal_title,angle,source_content,target_date,actor_id into new.internal_title,new.angle,new.source_content,new.target_date,new.actor_id
   from public.publication_revisions where id=new.parent_revision_id;
 end if;
 return new;
end $$;
create trigger publication_editorial_snapshot before insert on public.publication_revisions for each row execute function publications_private.editorial_snapshot();

create or replace function publications_private.add_manual_revision(p_publication_id uuid,p_client_id uuid,p_parent_id uuid,p_variants jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare revision uuid;item jsonb;variant uuid;asset jsonb;position integer;
begin
 if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 3 then raise exception 'Invalid variants' using errcode='22023';end if;
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

create function public.publication_save_draft(p_publication_id uuid,p_expected_revision_id uuid,p_client_id uuid,p_project_id uuid,p_title text,p_angle text,p_source text,p_target_date date,p_week date,p_slot smallint,p_variants jsonb,p_actor_id text)
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
  if slot is null then select s::smallint into slot from generate_series(1,2) s where not exists(select 1 from public.publications where client_id=p_client_id and editorial_week=week and publications.slot=s) order by s limit 1;end if;
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

create function public.publication_submit_manual(p_publication_id uuid,p_revision_id uuid,p_actor_id text) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023';end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.current_revision_id is distinct from p_revision_id or pub.status<>'draft' or pub.project_id is null then raise exception 'Stale or incomplete draft' using errcode='40001';end if;
 if not exists(select 1 from public.publication_variants where revision_id=p_revision_id) then raise exception 'Missing variants' using errcode='23514';end if;
 update public.publications set status='pending_review' where id=pub.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor_id,'publication.submitted',pub.client_id,'publication',pub.id,jsonb_build_object('revision_id',p_revision_id));
end $$;

-- Review all current variants atomically. Manual rejection never queues regeneration.
create function public.publication_review_manual(p_publication_id uuid,p_revision_id uuid,p_decision text,p_reason text,p_actor_id text) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_decision is null or p_decision not in('approved','rejected') or(p_decision='rejected' and coalesce(length(btrim(p_reason)),0)=0) then raise exception 'Invalid review' using errcode='22023';end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.current_revision_id is distinct from p_revision_id or pub.status<>'pending_review' or pub.project_id is null then raise exception 'Stale review' using errcode='40001';end if;
 insert into public.publication_reviews(publication_id,revision_id,variant_id,client_id,decision,reason,actor_id)
 select pub.id,p_revision_id,id,pub.client_id,p_decision,nullif(btrim(p_reason),''),p_actor_id from public.publication_variants where revision_id=p_revision_id;
 if not found then raise exception 'Missing variants' using errcode='23514';end if;
 update public.publications set status=p_decision where id=pub.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor_id,'publication.reviewed',pub.client_id,'publication',pub.id,jsonb_build_object('revision_id',p_revision_id,'decision',p_decision));
end $$;

create function public.publication_register_image(p_publication_id uuid,p_revision_id uuid,p_asset_id uuid,p_path text,p_hash text,p_mime text,p_provenance text,p_actor_id text) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023';end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.current_revision_id is distinct from p_revision_id then raise exception 'Stale upload' using errcode='40001';end if;
 if p_path<>pub.client_id::text||'/'||pub.id::text||'/'||p_asset_id::text then raise exception 'Invalid media path' using errcode='23514';end if;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed) values(p_asset_id,pub.client_id,p_path,p_hash,p_mime,p_provenance,true);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor_id,'publication.media_uploaded',pub.client_id,'publication',pub.id,jsonb_build_object('asset_id',p_asset_id,'revision_id',p_revision_id));
end $$;

revoke all on all functions in schema publications_private from public,anon,authenticated;
grant execute on all functions in schema publications_private to service_role;
revoke all on function public.publication_save_draft(uuid,uuid,uuid,uuid,text,text,text,date,date,smallint,jsonb,text),public.publication_submit_manual(uuid,uuid,text),public.publication_review_manual(uuid,uuid,text,text,text),public.publication_register_image(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.publication_save_draft(uuid,uuid,uuid,uuid,text,text,text,date,date,smallint,jsonb,text),public.publication_submit_manual(uuid,uuid,text),public.publication_review_manual(uuid,uuid,text,text,text),public.publication_register_image(uuid,uuid,uuid,text,text,text,text,text) to service_role;

-- Storage is provisioned only through this versioned migration. No policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('publication-images','publication-images',false,786432,array['image/jpeg','image/png','image/webp']);
