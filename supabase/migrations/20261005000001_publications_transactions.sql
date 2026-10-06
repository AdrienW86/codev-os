-- Three backend-only RPCs. No worker, credentials, networking or publishers.
create function publications_private.touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;

create function publications_private.prevent_history_change() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin raise exception 'Publication history is immutable' using errcode = '55000'; end;
$$;

create function publications_private.check_timezone() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid timezone' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger publication_client_timezone before insert or update on public.publication_client_settings
  for each row execute function publications_private.check_timezone();

create function publications_private.freeze_reviewed_content() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare revision uuid; publication uuid;
begin
  if tg_table_name = 'publication_variant_assets' then
    select v.revision_id, v.publication_id into revision, publication
      from public.publication_variants v where v.id = case when tg_op = 'DELETE' then old.variant_id else new.variant_id end;
  else
    revision := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
    publication := case when tg_op = 'DELETE' then old.publication_id else new.publication_id end;
  end if;
  -- Same parent lock as review/revise RPCs prevents content-review races.
  perform 1 from public.publications where id = publication for update;
  if exists (select 1 from public.publication_reviews where revision_id = revision) then
    raise exception 'Reviewed content requires a new revision' using errcode = '55000';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Content is versioned; create a new revision' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger publication_variants_frozen before insert or update or delete on public.publication_variants
  for each row execute function publications_private.freeze_reviewed_content();
create trigger publication_variant_assets_frozen before insert or update or delete on public.publication_variant_assets
  for each row execute function publications_private.freeze_reviewed_content();

create function publications_private.check_publication_state() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and (new.client_id, new.editorial_week, new.slot, new.subject)
    is distinct from (old.client_id, old.editorial_week, old.slot, old.subject) then
    raise exception 'Editorial identity is immutable' using errcode = '55000';
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
create trigger publications_state before insert or update on public.publications
  for each row execute function publications_private.check_publication_state();

create function publications_private.check_review() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare publication public.publications;
begin
  select * into publication from public.publications where id = new.publication_id for update;
  if publication.current_revision_id is distinct from new.revision_id or publication.status <> 'pending_review' then
    raise exception 'Only the pending current revision can be reviewed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger publication_reviews_current before insert on public.publication_reviews
  for each row execute function publications_private.check_review();

create function publications_private.check_delivery() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare publication public.publications;
begin
  select p.* into publication from public.publications p where p.id = new.publication_id for update;
  if tg_op = 'UPDATE' and (new.publication_id, new.publication_account_id, new.client_id, new.platform, new.idempotency_key)
    is distinct from (old.publication_id, old.publication_account_id, old.client_id, old.platform, old.idempotency_key) then
    raise exception 'Delivery identity is immutable' using errcode = '55000';
  end if;
  if new.status not in ('blocked','cancelled') and (
    publication.status <> 'approved' or not exists (
      select 1 from public.publication_variants v join public.publication_reviews r on r.variant_id = v.id
      where v.id = new.variant_id and v.revision_id = publication.current_revision_id and r.decision = 'approved'
    )
  ) then raise exception 'Delivery requires the approved current variant' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger publication_deliveries_approved before insert or update on public.publication_deliveries
  for each row execute function publications_private.check_delivery();

create function publications_private.check_attempt() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare job public.publication_jobs;
begin
  select * into job from public.publication_jobs where id = new.job_id;
  if new.delivery_id is distinct from job.delivery_id or new.attempt_number > job.max_attempts then
    raise exception 'Attempt does not match job' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger publication_attempts_context before insert on public.publication_attempts
  for each row execute function publications_private.check_attempt();

do $$
declare table_name text;
begin
  foreach table_name in array array['publication_settings','publication_client_settings','publication_accounts',
    'publications','publication_variants','publication_deliveries','publication_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function publications_private.touch_updated_at()', table_name || '_updated', table_name);
  end loop;
  foreach table_name in array array['publication_events','publication_reviews','publication_revisions','publication_assets','publication_attempts'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function publications_private.prevent_history_change()', table_name || '_immutable', table_name);
    execute format('create trigger %I before truncate on public.%I for each statement execute function publications_private.prevent_history_change()', table_name || '_no_truncate', table_name);
  end loop;
end;
$$;

-- Helper accepts only complete manual snapshots: one variant per platform and
-- ordered asset IDs. It inserts no tokens, model outputs or arbitrary metadata.
create function publications_private.add_manual_revision(
  p_publication_id uuid, p_client_id uuid, p_parent_id uuid, p_variants jsonb
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare revision uuid; item jsonb; variant uuid; asset jsonb; position integer;
begin
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) not between 1 and 3 then
    raise exception 'Provide one to three variants' using errcode = '22023';
  end if;
  insert into public.publication_revisions(publication_id,client_id,revision_number,parent_revision_id,origin)
    values (p_publication_id,p_client_id,
      coalesce((select max(revision_number) from public.publication_revisions where publication_id=p_publication_id),0)+1,
      p_parent_id,'manual') returning id into revision;
  for item in select value from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(item) <> 'object' or item - 'platform' - 'text_content' - 'asset_ids' <> '{}'::jsonb
      or jsonb_typeof(item->'platform') is distinct from 'string'
      or jsonb_typeof(item->'text_content') is distinct from 'string'
      or (item ? 'asset_ids' and jsonb_typeof(item->'asset_ids') <> 'array') then
      raise exception 'Invalid variant snapshot' using errcode = '22023';
    end if;
    insert into public.publication_variants(revision_id,publication_id,client_id,platform,text_content)
      values (revision,p_publication_id,p_client_id,item->>'platform',item->>'text_content') returning id into variant;
    position := 0;
    for asset in select value from jsonb_array_elements(coalesce(item->'asset_ids','[]'::jsonb)) loop
      if jsonb_typeof(asset) <> 'string' or position >= 10 then
        raise exception 'Invalid asset list' using errcode = '22023';
      end if;
      insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
        values (variant,(asset #>> '{}')::uuid,p_client_id,position);
      position := position + 1;
    end loop;
  end loop;
  return revision;
end;
$$;

create function public.publication_create_manual(
  p_client_id uuid, p_editorial_week date, p_slot smallint, p_subject text, p_variants jsonb, p_actor_id text
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare publication uuid; revision uuid;
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then
    raise exception 'Invalid admin actor' using errcode = '22023';
  end if;
  insert into public.publications(client_id,editorial_week,slot,subject)
    values(p_client_id,p_editorial_week,p_slot,btrim(p_subject)) returning id into publication;
  revision := publications_private.add_manual_revision(publication,p_client_id,null,p_variants);
  update public.publications set current_revision_id=revision, status='pending_review' where id=publication;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,after_data)
    values('admin',p_actor_id,'publication.created',p_client_id,'publication',publication,
      jsonb_build_object('revision_id',revision,'status','pending_review'));
  return publication;
end;
$$;

create function public.publication_revise_manual(
  p_publication_id uuid, p_expected_revision_id uuid, p_variants jsonb, p_actor_id text
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare publication public.publications; revision uuid;
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then
    raise exception 'Invalid admin actor' using errcode = '22023';
  end if;
  select * into publication from public.publications where id=p_publication_id for update;
  if not found or publication.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Stale revision' using errcode = '40001';
  end if;
  if exists (select 1 from public.publication_deliveries where publication_id=p_publication_id
    and status in ('processing','published','uncertain')) then
    raise exception 'Delivery must be resolved before revision' using errcode = '55000';
  end if;
  revision := publications_private.add_manual_revision(publication.id,publication.client_id,publication.current_revision_id,p_variants);
  update public.publication_deliveries set status='blocked' where publication_id=publication.id and status <> 'cancelled';
  update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null
    where publication_id=publication.id and status in ('pending','processing');
  update public.publications set current_revision_id=revision,status='pending_review' where id=publication.id;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
    values('admin',p_actor_id,'publication.revised',publication.client_id,'publication',publication.id,
      jsonb_build_object('revision_id',publication.current_revision_id,'status',publication.status),
      jsonb_build_object('revision_id',revision,'status','pending_review'));
  return revision;
end;
$$;

create function public.publication_review(
  p_publication_id uuid, p_revision_id uuid, p_variant_id uuid, p_decision text, p_reason text, p_actor_id text
) returns text language plpgsql security invoker set search_path = pg_catalog as $$
declare publication public.publications; new_status text := 'pending_review'; job uuid; review uuid;
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then
    raise exception 'Invalid admin actor' using errcode = '22023';
  end if;
  select * into publication from public.publications where id=p_publication_id for update;
  if not found or publication.current_revision_id is distinct from p_revision_id or publication.status <> 'pending_review' then
    raise exception 'Stale or non-pending revision' using errcode = '40001';
  end if;
  insert into public.publication_reviews(publication_id,revision_id,variant_id,client_id,decision,reason,actor_id)
    values(publication.id,p_revision_id,p_variant_id,publication.client_id,p_decision,nullif(btrim(p_reason),''),p_actor_id)
    returning id into review;
  if p_decision = 'rejected' then
    new_status := 'rejected';
    insert into public.publication_jobs(type,publication_id,revision_id,deduplication_key)
      values('regenerate',publication.id,p_revision_id,'regenerate:' || p_revision_id::text) returning id into job;
  elsif not exists (select 1 from public.publication_variants v where v.revision_id=p_revision_id
    and not exists(select 1 from public.publication_reviews r where r.variant_id=v.id and r.decision='approved')) then
    new_status := 'approved';
  end if;
  update public.publications set status=new_status where id=publication.id;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
    values('admin',p_actor_id,'publication.reviewed',publication.client_id,'publication',publication.id,
      jsonb_build_object('status',publication.status),jsonb_build_object('status',new_status),
      jsonb_build_object('revision_id',p_revision_id,'variant_id',p_variant_id,'review_id',review,'job_id',job,'decision',p_decision));
  return new_status;
end;
$$;

revoke all on all functions in schema publications_private from public, anon, authenticated;
grant execute on all functions in schema publications_private to service_role;
revoke all on function public.publication_create_manual(uuid,date,smallint,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.publication_revise_manual(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.publication_review(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.publication_create_manual(uuid,date,smallint,text,jsonb,text) to service_role;
grant execute on function public.publication_revise_manual(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.publication_review(uuid,uuid,uuid,text,text,text) to service_role;
