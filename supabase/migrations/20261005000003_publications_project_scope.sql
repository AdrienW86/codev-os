-- Scope is versioned with content. Jobs and deliveries derive it via their revision/variant.
alter table public.publications add column project_id uuid;
alter table public.publication_revisions add column project_id uuid;
alter table public.publications add constraint publications_project_client_fk foreign key(project_id,client_id)
  references public.projects(id,client_id) on delete restrict not valid;
alter table public.publication_revisions add constraint publication_revisions_project_client_fk foreign key(project_id,client_id)
  references public.projects(id,client_id) on delete restrict not valid;
create index publications_project_idx on public.publications(project_id,client_id);
alter table public.publication_deliveries add column published_at timestamptz;
create index publication_deliveries_published_idx on public.publication_deliveries(client_id,published_at) where published_at is not null;

create function publications_private.project_platform_allowed(p_project uuid,p_client uuid,p_platform text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select p_project is null or exists(select 1 from public.projects where id=p_project and client_id=p_client and
  ((type='Réseaux sociaux' and p_platform in ('facebook','instagram')) or
   (type='Google Business Profile' and p_platform='google_business_profile')));
$$;
create function publications_private.revision_project() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare target uuid;
begin
 select project_id into target from public.publications where id=new.publication_id and client_id=new.client_id for update;
 -- An audited target change supplies its snapshot explicitly, before changing
 -- the root. Ordinary revision creation inherits the current root project.
 if nullif(current_setting('codev.publication_actor',true),'') is null then new.project_id:=target; end if;
 return new;
end $$;
create trigger publication_revision_project before insert on public.publication_revisions
 for each row execute function publications_private.revision_project();
create function publications_private.variant_project() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare target uuid;
begin
 select project_id into target from public.publication_revisions where id=new.revision_id;
 if not publications_private.project_platform_allowed(target,new.client_id,new.platform) then
  raise exception 'Platform incompatible with project' using errcode='23514';
 end if;
 return new;
end $$;
create trigger publication_variant_project before insert on public.publication_variants
 for each row execute function publications_private.variant_project();
create function publications_private.protect_project() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.project_id is distinct from old.project_id and nullif(current_setting('codev.publication_actor',true),'') is null then
  raise exception 'Use audited publication_set_project RPC' using errcode='42501';
 end if;
 return new;
end $$;
create trigger publications_project_change before update of project_id on public.publications
 for each row execute function publications_private.protect_project();
create function publications_private.project_consistency() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publications p join public.publication_revisions r on r.id=p.current_revision_id
   where p.id=new.id and r.project_id is distinct from p.project_id) then
  raise exception 'Current revision project mismatch' using errcode='23514';
 end if;
 return null;
end $$;
create constraint trigger publications_project_consistency after insert or update on public.publications
 deferrable initially deferred for each row execute function publications_private.project_consistency();
create function publications_private.delivery_publication_time() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  new.published_at:=case when new.status='published' then clock_timestamp() else null end;
 elsif new.status='published' and old.status<>'published' then new.published_at:=clock_timestamp();
 else new.published_at:=old.published_at;
 end if;
 return new;
end $$;
create trigger publication_delivery_time before insert or update on public.publication_deliveries
 for each row execute function publications_private.delivery_publication_time();

create function public.publication_set_project(p_publication_id uuid,p_expected_revision_id uuid,p_project_id uuid,p_actor_id text)
 returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare publication public.publications; revision uuid; source_variant public.publication_variants; new_variant uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023'; end if;
 select * into publication from public.publications where id=p_publication_id for update;
 if not found or publication.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale publication' using errcode='40001'; end if;
 if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and client_id=publication.client_id and type in ('Réseaux sociaux','Google Business Profile')) then
  raise exception 'Invalid publication project' using errcode='23514';
 end if;
 if exists(select 1 from public.publication_deliveries where publication_id=publication.id and status in ('processing','published','uncertain')) then
  raise exception 'Resolve deliveries first' using errcode='55000';
 end if;
 if publication.project_id is not distinct from p_project_id then return publication.current_revision_id; end if;
 perform set_config('codev.publication_actor',p_actor_id,true);
 if publication.current_revision_id is not null then
  insert into public.publication_revisions(publication_id,client_id,project_id,revision_number,parent_revision_id,origin)
   values(publication.id,publication.client_id,p_project_id,(select max(revision_number)+1 from public.publication_revisions where publication_id=publication.id),publication.current_revision_id,'manual') returning id into revision;
  for source_variant in select * from public.publication_variants where revision_id=publication.current_revision_id order by platform loop
   insert into public.publication_variants(revision_id,publication_id,client_id,platform,text_content,metadata)
    values(revision,publication.id,publication.client_id,source_variant.platform,source_variant.text_content,source_variant.metadata) returning id into new_variant;
   insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
    select new_variant,asset_id,client_id,sort_order from public.publication_variant_assets where variant_id=source_variant.id;
  end loop;
  update public.publication_deliveries set status='blocked' where publication_id=publication.id and status<>'cancelled';
  update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null where publication_id=publication.id and status in ('pending','processing');
  -- One write keeps the root consistent even with SET CONSTRAINTS IMMEDIATE.
  update public.publications set project_id=p_project_id,current_revision_id=revision,status='pending_review' where id=publication.id;
 else
  update public.publications set project_id=p_project_id where id=publication.id;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
 values('admin',p_actor_id,'publication.project_changed',publication.client_id,'publication',publication.id,
   jsonb_build_object('project_id',publication.project_id,'revision_id',publication.current_revision_id),
   jsonb_build_object('project_id',p_project_id,'revision_id',revision));
 perform set_config('codev.publication_actor','',true);
 return revision;
end $$;
-- Prevent changing project type/owner after it has become an operational scope.
create function agent_scope_private.protect_project_identity() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.client_id is distinct from old.client_id then raise exception 'Project client is immutable' using errcode='55000'; end if;
 if new.type is distinct from old.type and exists(select 1 from public.publication_revisions where project_id=old.id) then
  raise exception 'Project type has publication history' using errcode='55000';
 end if;
 return new;
end $$;
create trigger projects_scope_identity before update of client_id,type on public.projects
 for each row execute function agent_scope_private.protect_project_identity();
revoke all on all functions in schema publications_private from public,anon,authenticated;
grant execute on all functions in schema publications_private to service_role;
revoke all on function agent_scope_private.protect_project_identity() from public,anon,authenticated;
grant execute on function agent_scope_private.protect_project_identity() to service_role;
revoke all on function public.publication_set_project(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.publication_set_project(uuid,uuid,uuid,text) to service_role;
create function public.publication_create_project_manual(p_client_id uuid,p_project_id uuid,p_editorial_week date,p_slot smallint,p_subject text,p_variants jsonb,p_actor_id text)
 returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare publication uuid; revision uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and client_id=p_client_id and type in ('Réseaux sociaux','Google Business Profile')) then
  raise exception 'Invalid publication project' using errcode='23514';
 end if;
 insert into public.publications(client_id,project_id,editorial_week,slot,subject) values(p_client_id,p_project_id,p_editorial_week,p_slot,btrim(p_subject)) returning id into publication;
 revision:=publications_private.add_manual_revision(publication,p_client_id,null,p_variants);
 update public.publications set current_revision_id=revision,status='pending_review' where id=publication;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,after_data)
 values('admin',p_actor_id,'publication.created',p_client_id,'publication',publication,jsonb_build_object('project_id',p_project_id,'revision_id',revision,'status','pending_review'));
 return publication;
end $$;
revoke all on function public.publication_create_project_manual(uuid,uuid,date,smallint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_create_project_manual(uuid,uuid,date,smallint,text,jsonb,text) to service_role;
