-- Lot 4.3 P7: Agent Publications v2 (occurrence-driven) + archive hardening.
-- The agent turns open channel occurrences into ONE draft mono-platform publication per occurrence, grouped in one
-- editorial group when several platforms share the idea. Persistence reuses the P4-b creation logic. Drafts only:
-- no submission, no approval, no delivery, no job, no external call from the database.

-- 1. Archive hardening: an archived publication accepts no new image, media link, review, delivery or AI run.
-- Trigger names start with 'archived_guard_' so that they fire before every existing check on these tables.
create or replace function public.publication_register_image(p_publication_id uuid,p_revision_id uuid,p_asset_id uuid,p_path text,p_hash text,p_mime text,p_provenance text,p_actor_id text) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023';end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if found and pub.archived_at is not null then raise exception 'Archived publication is immutable' using errcode='55000';end if;
 if not found or pub.current_revision_id is distinct from p_revision_id then raise exception 'Stale upload' using errcode='40001';end if;
 if p_path<>pub.client_id::text||'/'||pub.id::text||'/'||p_asset_id::text then raise exception 'Invalid media path' using errcode='23514';end if;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed) values(p_asset_id,pub.client_id,p_path,p_hash,p_mime,p_provenance,true);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor_id,'publication.media_uploaded',pub.client_id,'publication',pub.id,jsonb_build_object('asset_id',p_asset_id,'revision_id',p_revision_id));
end $$;
create trigger archived_guard_review before insert on public.publication_reviews
 for each row execute function publications_private.guard_archived_publication_child();
create trigger archived_guard_delivery before insert on public.publication_deliveries
 for each row execute function publications_private.guard_archived_publication_child();
create trigger archived_guard_ai_run before insert on public.publication_ai_runs
 for each row execute function publications_private.guard_archived_publication_child();
create trigger archived_guard_media_use before insert on public.publication_media_uses
 for each row execute function publications_private.guard_archived_publication_child();
create trigger archived_guard_generation_details before insert on public.publication_generation_details
 for each row execute function publications_private.guard_archived_publication_child();
create function publications_private.guard_archived_variant_asset() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publication_variants v join public.publications p on p.id=v.publication_id where v.id=new.variant_id and p.archived_at is not null) then
  raise exception 'Archived publication is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger archived_guard_variant_asset before insert on public.publication_variant_assets
 for each row execute function publications_private.guard_archived_variant_asset();

-- 2. Revision origin: an agent-generated revision is recorded as 'generated' (snapshot setting, insert time only).
create or replace function publications_private.editorial_snapshot() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare value jsonb;
begin
 value:=nullif(current_setting('codev.publication_editorial',true),'')::jsonb;
 if value is not null then
  new.internal_title:=value->>'title';new.angle:=value->>'angle';new.source_content:=value->>'source';
  new.target_date:=nullif(value->>'target_date','')::date;new.actor_id:=value->>'actor';
  new.project_id:=(value->>'project')::uuid;
  if value->>'origin'='generated' then new.origin:='generated'; end if;
 elsif new.parent_revision_id is not null then
  select internal_title,angle,source_content,target_date,actor_id into new.internal_title,new.angle,new.source_content,new.target_date,new.actor_id
   from public.publication_revisions where id=new.parent_revision_id;
 end if;
 return new;
end $$;

-- 3. Single creation logic (P4-b), shared by the manual RPC and the agent. Origin 'manual' or 'agent'.
create function publications_private.create_publication_from_occurrence(p_occurrence_id uuid,p_editorial_group_id uuid,p_new_group_subject text,
 p_subject text,p_angle text,p_text_content text,p_metadata jsonb,p_actor_id text,p_origin text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare occ public.publication_channel_occurrences;grp public.publication_editorial_groups;group_created boolean:=false;
 publication uuid;revision uuid;subject text:=btrim(p_subject);content text:=btrim(p_text_content);new_group text:=nullif(btrim(p_new_group_subject),'');
 angle text:=coalesce(nullif(btrim(p_angle),''),btrim(p_subject));metadata jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_occurrence_id is null or p_origin is null or p_origin not in('manual','agent')
  or subject is null or length(subject) not between 1 and 300 or subject ~ '[\x00-\x1f]'
  or content is null or length(content) not between 1 and 10000
  or angle is null or length(angle)>3000
  or (p_editorial_group_id is not null and new_group is not null)
  or (new_group is not null and (length(new_group)>300 or new_group ~ '[\x00-\x1f]'))
  or not publications_private.safe_metadata(metadata) then
  raise exception 'Invalid publication' using errcode='22023'; end if;
 select * into occ from public.publication_channel_occurrences where id=p_occurrence_id for update;
 if not found then raise exception 'Invalid occurrence' using errcode='23514'; end if;
 if occ.skipped_at is not null then raise exception 'Occurrence skipped' using errcode='23514'; end if;
 if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23505'; end if;
 if p_editorial_group_id is not null then
  select * into grp from public.publication_editorial_groups where id=p_editorial_group_id for update;
  if not found or grp.client_id<>occ.client_id or grp.project_id<>occ.project_id then
   raise exception 'Editorial group outside the occurrence project' using errcode='23514'; end if;
 elsif new_group is not null then
  insert into public.publication_editorial_groups(client_id,project_id,subject,origin) values(occ.client_id,occ.project_id,new_group,p_origin) returning * into grp;
  group_created:=true;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.editorial_group_created',occ.client_id,'editorial_group',grp.id,
   jsonb_build_object('project_id',occ.project_id,'editorial_group_id',grp.id,'occurrence_id',occ.id));
 end if;
 insert into public.publications(client_id,project_id,editorial_week,slot,subject,target_date,platform,occurrence_id,editorial_group_id,creation_origin)
 values(occ.client_id,occ.project_id,(date_trunc('week',occ.local_date::timestamp))::date,1,subject,occ.local_date,occ.platform,occ.id,grp.id,p_origin)
 returning id into publication;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',subject,'angle',angle,'source',content,'target_date',occ.local_date,
  'actor',p_actor_id,'project',occ.project_id,'origin',case when p_origin='agent' then 'generated' else 'manual' end)::text,true);
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
-- The manual RPC keeps its exact signature, validations, error codes and audit (now through the shared logic).
create or replace function public.publication_create_from_occurrence(p_occurrence_id uuid,p_editorial_group_id uuid,p_new_group_subject text,
 p_subject text,p_text_content text,p_metadata jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 return publications_private.create_publication_from_occurrence(p_occurrence_id,p_editorial_group_id,p_new_group_subject,p_subject,null,p_text_content,p_metadata,p_actor_id,'manual');
end $$;

-- 4. Agent v2 runs: one per explicit preparation request, tied to agent_runs, leased, budgeted with Agent v1.
create table public.publication_agent_v2_runs(
 id uuid primary key default gen_random_uuid(),
 agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
 agent_id uuid not null references public.agents(id) on delete restrict,
 client_id uuid not null,
 project_id uuid not null,
 status text not null default 'processing' check(status in('processing','completed','failed')),
 occurrence_ids uuid[] not null check(cardinality(occurrence_ids) between 1 and 3),
 considered_count integer not null check(considered_count between 1 and 1000),
 selected_media_id uuid,
 editorial_group_id uuid,
 publication_ids uuid[] not null default '{}' check(cardinality(publication_ids)<=3),
 reserved_cost_eur numeric not null default .1 check(reserved_cost_eur=.1),
 estimated_cost_eur numeric not null default 0 check(estimated_cost_eur between 0 and .1),
 input_tokens integer not null default 0 check(input_tokens>=0),
 output_tokens integer not null default 0 check(output_tokens>=0),
 model text not null default 'gpt-4.1-mini-2025-04-14' check(length(model) between 1 and 100),
 error_code text check(error_code in('invalid_output','unsupported_claim','occurrence_unavailable','generation_failed','context_unavailable','lease_expired')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 lease_until timestamptz not null default now()+interval '15 minutes',
 check(considered_count>=cardinality(occurrence_ids)),
 check((status='processing')=(completed_at is null)),
 check(status<>'failed' or error_code is not null),
 constraint publication_agent_v2_runs_project_fk foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict,
 constraint publication_agent_v2_runs_media_fk foreign key(selected_media_id,client_id) references public.publication_drive_media(id,client_id) on delete restrict,
 constraint publication_agent_v2_runs_group_fk foreign key(editorial_group_id,client_id,project_id) references public.publication_editorial_groups(id,client_id,project_id) on delete restrict
);
create unique index publication_agent_v2_runs_active on public.publication_agent_v2_runs(project_id) where status='processing';
create index publication_agent_v2_runs_budget on public.publication_agent_v2_runs(agent_id,created_at,status);
create function publications_private.guard_agent_v2_run() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.agent_run_id,new.agent_id,new.client_id,new.project_id,new.occurrence_ids,new.considered_count,new.created_at,new.reserved_cost_eur)
    is distinct from (old.id,old.agent_run_id,old.agent_id,old.client_id,old.project_id,old.occurrence_ids,old.considered_count,old.created_at,old.reserved_cost_eur)
  or old.status<>'processing' then
  raise exception 'Agent run is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger agent_v2_run_guard before update on public.publication_agent_v2_runs for each row execute function publications_private.guard_agent_v2_run();
create trigger agent_v2_run_no_delete before delete on public.publication_agent_v2_runs for each row execute function publications_private.prevent_history_change();
create trigger agent_v2_run_no_truncate before truncate on public.publication_agent_v2_runs for each statement execute function publications_private.prevent_history_change();

-- Monthly spend of the specialist agent across Agent v1 and v2 runs (processing runs count their reservation).
create function publications_private.agent_month_spend(p_agent uuid) returns numeric
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce((select sum(case when status='processing' then reserved_cost_eur else estimated_cost_eur end) from public.publication_ai_runs
   where agent_id=p_agent and created_at>=date_trunc('month',now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'),0)
  +coalesce((select sum(case when status='processing' then reserved_cost_eur else estimated_cost_eur end) from public.publication_agent_v2_runs
   where agent_id=p_agent and created_at>=date_trunc('month',now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'),0);
$$;

create function public.publication_agent_v2_begin(p_project_id uuid,p_occurrence_ids uuid[],p_considered integer,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare p public.projects;c public.publication_agent_projects;a public.agents;r public.publication_agent_v2_runs;old public.publication_agent_v2_runs;agent_run uuid;n integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_project_id is null or p_occurrence_ids is null
  or cardinality(p_occurrence_ids) not between 1 and 3 or array_position(p_occurrence_ids,null) is not null
  or (select count(distinct x) from unnest(p_occurrence_ids) x)<>cardinality(p_occurrence_ids)
  or p_considered is null or p_considered<cardinality(p_occurrence_ids) or p_considered>1000 then
  raise exception 'Invalid agent request' using errcode='22023'; end if;
 select * into p from public.projects where id=p_project_id;
 if not found then raise exception 'Invalid project' using errcode='23514'; end if;
 select * into c from public.publication_agent_projects where project_id=p.id and client_id=p.client_id;
 if not found or not c.enabled or not c.rights_confirmed then raise exception 'Preparation disabled' using errcode='55000'; end if;
 -- Lock order: agent (budget), project, occurrences. Same agent lock as Agent v1.
 select * into a from public.agents where id=c.agent_id for update;
 select * into p from public.projects where id=p.id for no key update;
 if not a.publication_specialist or not agent_scope_private.context_allowed(a.id,p.client_id,p.id) then raise exception 'Agent scope invalid' using errcode='23514'; end if;
 if not exists(select 1 from public.publication_project_channels where project_id=p.id and client_id=p.client_id) then raise exception 'Project channels not configured' using errcode='23514'; end if;
 for old in select * from public.publication_agent_v2_runs where agent_id=a.id and status='processing' and lease_until<=now() for update loop
  update public.publication_agent_v2_runs set status='failed',error_code='lease_expired',estimated_cost_eur=reserved_cost_eur,completed_at=now() where id=old.id;
  update public.agent_runs set status='failed',completed_at=now(),estimated_cost_eur=old.reserved_cost_eur,summary='Preparation expired; budget retained conservatively' where id=old.agent_run_id;
  insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata)
  values('system','publication.agent_v2_failed',old.client_id,'project',old.project_id,jsonb_build_object('run_id',old.id,'project_id',old.project_id,'code','lease_expired'));
 end loop;
 select * into r from public.publication_agent_v2_runs where project_id=p.id and status='processing';
 if found then return jsonb_build_object('run_id',r.id,'reused',true); end if;
 select count(*) into n from (select o.id from public.publication_channel_occurrences o where o.id=any(p_occurrence_ids) for update) x;
 if n<>cardinality(p_occurrence_ids) or exists(select 1 from public.publication_channel_occurrences o where o.id=any(p_occurrence_ids)
   and (o.project_id<>p.id or o.client_id<>p.client_id or o.publication_id is not null or o.skipped_at is not null or o.scheduled_for<=now()))
  or (select count(distinct platform) from public.publication_channel_occurrences where id=any(p_occurrence_ids))<>cardinality(p_occurrence_ids) then
  raise exception 'Occurrence unavailable' using errcode='23514'; end if;
 if a.max_monthly_budget_eur is not null and publications_private.agent_month_spend(a.id)+.1>a.max_monthly_budget_eur then raise exception 'Budget limit reached' using errcode='55000'; end if;
 insert into public.agent_runs(agent_id,client_id,project_id,status,summary,metadata)
 values(a.id,p.client_id,p.id,'running','Publications agent v2 preparation',jsonb_build_object('agent_v2',true,'occurrences',cardinality(p_occurrence_ids),'considered',p_considered)) returning id into agent_run;
 insert into public.publication_agent_v2_runs(agent_run_id,agent_id,client_id,project_id,occurrence_ids,considered_count)
 values(agent_run,a.id,p.client_id,p.id,p_occurrence_ids,p_considered) returning * into r;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_started',p.client_id,'project',p.id,
  jsonb_build_object('run_id',r.id,'project_id',p.id,'considered',p_considered,'selected',cardinality(p_occurrence_ids)));
 return jsonb_build_object('run_id',r.id,'reused',false);
end $$;

-- Atomic batch creation after a validated generation: all drafts or nothing (shared creation logic, one group
-- for 2+ platforms). Any occurrence that became unavailable aborts the whole batch.
create function public.publication_agent_v2_finish(p_run_id uuid,p_output jsonb,p_media_id uuid,p_usage jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;item jsonb;subject text;angle text;created jsonb;group_id uuid;ids uuid[]:=array[]::uuid[];seen uuid[]:=array[]::uuid[];
 occurrence uuid;cost numeric;tokens_in integer;tokens_out integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null
  or jsonb_typeof(p_output) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_output) k) is distinct from array['idea','publications']
  or jsonb_typeof(p_output->'idea') is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_output->'idea') k) is distinct from array['angle','subject']
  or jsonb_typeof(p_output->'publications') is distinct from 'array'
  or jsonb_typeof(p_usage) is distinct from 'object' or jsonb_typeof(p_usage->'input_tokens') is distinct from 'number' or jsonb_typeof(p_usage->'output_tokens') is distinct from 'number'
  or jsonb_typeof(p_usage->'estimated_cost_eur') is distinct from 'number' then
  raise exception 'Invalid agent output' using errcode='22023'; end if;
 subject:=btrim(p_output->'idea'->>'subject');angle:=btrim(p_output->'idea'->>'angle');
 tokens_in:=(p_usage->>'input_tokens')::integer;tokens_out:=(p_usage->>'output_tokens')::integer;cost:=(p_usage->>'estimated_cost_eur')::numeric;
 if subject is null or length(subject) not between 1 and 300 or angle is null or length(angle) not between 1 and 3000
  or tokens_in<0 or tokens_out<0 or cost<0 or cost>.1 then raise exception 'Invalid agent output' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'processing' or r.lease_until<=now() then raise exception 'Agent run not active' using errcode='55000'; end if;
 if jsonb_array_length(p_output->'publications')<>cardinality(r.occurrence_ids) then raise exception 'Invalid agent output' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_output->'publications') loop
  if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['cta','occurrence_id','text']
   or jsonb_typeof(item->'occurrence_id') is distinct from 'string' or jsonb_typeof(item->'text') is distinct from 'string'
   or jsonb_typeof(item->'cta') not in('string','null') then raise exception 'Invalid agent output' using errcode='22023'; end if;
  occurrence:=(item->>'occurrence_id')::uuid;
  if not (occurrence=any(r.occurrence_ids)) or occurrence=any(seen) then raise exception 'Invalid agent output' using errcode='22023'; end if;
  seen:=seen||occurrence;
 end loop;
 if p_media_id is not null and not exists(select 1 from public.publication_drive_media m where m.id=p_media_id and m.client_id=r.client_id
   and coalesce((m.analysis->>'usable')::boolean,false) and m.claimed_run_id is null and not exists(select 1 from public.publication_media_uses u where u.media_id=m.id)) then
  raise exception 'Invalid agent media' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_output->'publications') order by value->>'occurrence_id' loop
  created:=publications_private.create_publication_from_occurrence((item->>'occurrence_id')::uuid,group_id,
   case when group_id is null and cardinality(r.occurrence_ids)>1 then subject end,subject,angle,item->>'text',
   case when jsonb_typeof(item->'cta')='string' and btrim(item->>'cta')<>'' then jsonb_build_object('cta',btrim(item->>'cta')) else '{}'::jsonb end,p_actor_id,'agent');
  group_id:=coalesce(group_id,(created->>'editorial_group_id')::uuid);ids:=ids||(created->>'publication_id')::uuid;
 end loop;
 update public.publication_agent_v2_runs set status='completed',completed_at=now(),publication_ids=ids,editorial_group_id=group_id,selected_media_id=p_media_id,
  input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost where id=r.id;
 update public.agent_runs set status='completed',completed_at=now(),summary='Prepared drafts for human review',input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost,
  metadata=metadata||jsonb_build_object('agent_v2_run_id',r.id,'publications',cardinality(ids)) where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_completed',r.client_id,'project',r.project_id,
  jsonb_build_object('run_id',r.id,'project_id',r.project_id,'occurrence_ids',to_jsonb(r.occurrence_ids),'publication_ids',to_jsonb(ids),
   'editorial_group_id',group_id,'with_media',p_media_id is not null));
 return jsonb_build_object('run_id',r.id,'publication_ids',to_jsonb(ids),'editorial_group_id',group_id);
end $$;

create function public.publication_agent_v2_fail(p_run_id uuid,p_error_code text,p_usage jsonb,p_actor_id text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;cost numeric:=coalesce((p_usage->>'estimated_cost_eur')::numeric,0);
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null
  or p_error_code is null or p_error_code not in('invalid_output','unsupported_claim','occurrence_unavailable','generation_failed','context_unavailable')
  or jsonb_typeof(p_usage) is distinct from 'object' or cost<0 or cost>.1 then raise exception 'Invalid agent failure' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'processing' then raise exception 'Agent run not active' using errcode='55000'; end if;
 update public.publication_agent_v2_runs set status='failed',error_code=p_error_code,completed_at=now(),estimated_cost_eur=cost,
  input_tokens=greatest(coalesce((p_usage->>'input_tokens')::integer,0),0),output_tokens=greatest(coalesce((p_usage->>'output_tokens')::integer,0),0) where id=r.id;
 update public.agent_runs set status='failed',completed_at=now(),summary=p_error_code,estimated_cost_eur=cost where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_failed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'project_id',r.project_id,'code',p_error_code));
end $$;

alter table public.publication_agent_v2_runs enable row level security;
revoke all on public.publication_agent_v2_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_agent_v2_runs to service_role;
revoke all on function publications_private.guard_archived_variant_asset(),publications_private.create_publication_from_occurrence(uuid,uuid,text,text,text,text,jsonb,text,text),
 publications_private.guard_agent_v2_run(),publications_private.agent_month_spend(uuid) from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_archived_variant_asset(),publications_private.create_publication_from_occurrence(uuid,uuid,text,text,text,text,jsonb,text,text),
 publications_private.guard_agent_v2_run(),publications_private.agent_month_spend(uuid) to service_role;
revoke all on function public.publication_agent_v2_begin(uuid,uuid[],integer,text),public.publication_agent_v2_finish(uuid,jsonb,uuid,jsonb,text),
 public.publication_agent_v2_fail(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_agent_v2_begin(uuid,uuid[],integer,text),public.publication_agent_v2_finish(uuid,jsonb,uuid,jsonb,text),
 public.publication_agent_v2_fail(uuid,text,jsonb,text) to service_role;
