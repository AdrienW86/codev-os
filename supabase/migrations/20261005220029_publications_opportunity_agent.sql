-- Lot 4: explicit manual preparation only. No global setting change, cron or publisher.
alter table public.agents add column publication_specialist boolean not null default false;
alter table public.agents add constraint publications_specialist_scope check(not publication_specialist or (agent_scope='project' and not scope_review_required));
create unique index agents_one_publications_specialist on public.agents(publication_specialist) where publication_specialist;
insert into public.agents(name,status,enabled,instructions,agent_scope,scope_review_required,publication_specialist,model,max_monthly_budget_eur)
values('Agent Publications','Actif',false,'Photo-first. Prestations confirmées uniquement. Validation humaine obligatoire. Aucune publication externe.','project',false,true,'gpt-4.1-mini-2025-04-14',5);
create table public.publication_agent_projects(
 project_id uuid primary key,client_id uuid not null,agent_id uuid not null references public.agents(id) on delete restrict,
 enabled boolean not null default false,drive_folder_id text not null check(drive_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
 rights_confirmed boolean not null default false,verified_services jsonb not null check(jsonb_typeof(verified_services)='array' and jsonb_array_length(verified_services) between 1 and 20),
 editorial_rules text not null default '' check(length(editorial_rules)<=4000),updated_at timestamptz not null default now(),
 foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict
);
create table public.publication_ai_runs(
 id uuid primary key default gen_random_uuid(),agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
 agent_id uuid not null references public.agents(id) on delete restrict,client_id uuid not null,project_id uuid not null,publication_id uuid not null,
 expected_revision_id uuid,idempotency_key text not null,attempt integer not null check(attempt between 1 and 3),
 status text not null default 'processing' check(status in('processing','completed','failed','needs_review')),
 reserved_cost_eur numeric not null default .1 check(reserved_cost_eur=.1),estimated_cost_eur numeric not null default 0 check(estimated_cost_eur between 0 and .1),
 input_tokens integer not null default 0 check(input_tokens>=0),output_tokens integer not null default 0 check(output_tokens>=0),model text not null default 'gpt-4.1-mini-2025-04-14',
 error_code text check(error_code in('media_required','needs_review','preparation_failed','lease_expired')),created_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '15 minutes',
 revision_id uuid,unique(idempotency_key,attempt),unique(id,publication_id,client_id),unique(id,client_id),
 check(idempotency_key=publication_id::text||':'||coalesce(expected_revision_id::text,'initial')),
 foreign key(publication_id,project_id,client_id) references public.publications(id,project_id,client_id) on delete restrict,
 foreign key(expected_revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict,
 foreign key(revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict
);
create index publication_agent_projects_client on public.publication_agent_projects(client_id,project_id);
create index publication_agent_projects_agent on public.publication_agent_projects(agent_id,project_id);
create unique index publication_ai_runs_active on public.publication_ai_runs(publication_id) where status='processing';
create index publication_ai_runs_budget on public.publication_ai_runs(agent_id,created_at,status);
create table public.publication_drive_media(
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,
 drive_file_id text not null check(drive_file_id ~ '^[a-zA-Z0-9_-]{10,200}$'),drive_folder_id text not null,
 name text not null check(length(name)<=300),mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),
 modified_at timestamptz not null,width integer,height integer,file_size bigint not null check(file_size between 1 and 8388608),
 file_hash text check(file_hash ~ '^[a-f0-9]{64}$'),original_path text,analysis jsonb,
 claimed_run_id uuid,
 foreign key(claimed_run_id,client_id) references public.publication_ai_runs(id,client_id) on delete restrict,
 unique(client_id,drive_file_id),unique(id,client_id),created_at timestamptz not null default now()
);
create unique index publication_drive_media_hash on public.publication_drive_media(client_id,file_hash) where file_hash is not null;
create index publication_drive_media_catalog on public.publication_drive_media(client_id,drive_folder_id,modified_at desc);
create index publication_drive_media_claim on public.publication_drive_media(claimed_run_id) where claimed_run_id is not null;
create table public.publication_media_uses(
 id uuid primary key default gen_random_uuid(),media_id uuid not null,asset_id uuid not null,publication_id uuid not null,revision_id uuid not null,client_id uuid not null,
 platform text not null check(platform in('facebook','instagram','google_business_profile')),used_at timestamptz not null default now(),
 foreign key(media_id,client_id) references public.publication_drive_media(id,client_id) on delete restrict,
 foreign key(asset_id,client_id) references public.publication_assets(id,client_id) on delete restrict,
 foreign key(revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict,
 unique(media_id,revision_id,platform)
);
create index publication_media_uses_history on public.publication_media_uses(client_id,media_id,used_at);
create index publication_media_uses_revision on public.publication_media_uses(revision_id,publication_id,client_id);
create index publication_media_uses_asset on public.publication_media_uses(asset_id,client_id);
create table public.publication_generation_details(
 revision_id uuid primary key,publication_id uuid not null,client_id uuid not null,run_id uuid not null unique,
 foreign key(run_id,publication_id,client_id) references public.publication_ai_runs(id,publication_id,client_id) on delete restrict,
 selected_opportunity jsonb not null,media_id uuid not null,factual_basis jsonb not null,generation_summary text not null check(length(generation_summary)<=1000),
 foreign key(revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict,
 foreign key(media_id,client_id) references public.publication_drive_media(id,client_id) on delete restrict
);
create index publication_generation_details_publication on public.publication_generation_details(publication_id,client_id);
create index publication_generation_details_media on public.publication_generation_details(media_id,client_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('publication-originals','publication-originals',false,8388608,array['image/jpeg','image/png','image/webp']);
do $$declare t text;begin
 foreach t in array array['publication_agent_projects','publication_ai_runs','publication_drive_media','publication_media_uses','publication_generation_details'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert on public.%I to service_role',t);
  if t in('publication_agent_projects','publication_ai_runs','publication_drive_media') then execute format('grant update on public.%I to service_role',t);end if;
  if t in('publication_media_uses','publication_generation_details') then execute format('create trigger %I before update on public.%I for each row execute function publications_private.prevent_history_change()',t||'_no_update',t);end if;
  execute format('create trigger %I before delete on public.%I for each row execute function publications_private.prevent_history_change()',t||'_no_delete',t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function publications_private.prevent_history_change()',t||'_no_truncate',t);
 end loop;
end $$;
create function publications_private.specialist_project_guard() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.agents where id=new.agent_id and publication_specialist) and not exists(select 1 from public.projects where id=new.project_id and type in('Réseaux sociaux','Google Business Profile')) then raise exception 'Specialist project invalid' using errcode='23514';end if;return new;
end $$;
create trigger publications_specialist_assignment before insert or update on public.agent_project_assignments for each row execute function publications_private.specialist_project_guard();
create function public.publication_agent_configure(p_project uuid,p_folder text,p_services jsonb,p_rules text,p_enabled boolean,p_rights boolean,p_actor text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare p public.projects;a public.agents;
begin
 if p_actor is null or p_actor !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_enabled is null or p_rights is distinct from true or jsonb_typeof(p_services) is distinct from 'array'
 or exists(select 1 from jsonb_array_elements_text(p_services) s where length(s) not between 2 and 100 or s !~ '^[[:alpha:]À-ÿ ''-]+$') then raise exception 'Invalid configuration' using errcode='22023';end if;
 select * into p from public.projects where id=p_project for no key update;
 if not found or p.type not in('Réseaux sociaux','Google Business Profile') then raise exception 'Invalid project' using errcode='23514';end if;
 select * into a from public.agents where publication_specialist for update;
 update public.agents set enabled=true where id=a.id;
 insert into public.agent_client_assignments(agent_id,client_id,enabled) values(a.id,p.client_id,true) on conflict(agent_id,client_id) do update set enabled=true;
 perform public.agent_project_assignment_set(a.id,p.id,p_enabled,p_actor);
 insert into public.publication_agent_projects(project_id,client_id,agent_id,enabled,drive_folder_id,rights_confirmed,verified_services,editorial_rules)
 values(p.id,p.client_id,a.id,p_enabled,p_folder,true,p_services,p_rules) on conflict(project_id) do update set enabled=excluded.enabled,drive_folder_id=excluded.drive_folder_id,rights_confirmed=true,verified_services=excluded.verified_services,editorial_rules=excluded.editorial_rules,updated_at=now();
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id) values('admin',p_actor,'publication.agent_configured',p.client_id,'project',p.id);return a.id;
end $$;
create function public.publication_ai_begin(p_publication uuid,p_expected uuid,p_actor text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare p public.publications;c public.publication_agent_projects;a public.agents;r public.publication_ai_runs;old public.publication_ai_runs;key text;attempt integer;agent_run uuid;spent numeric;
begin
 if p_actor is null or p_actor !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023';end if;
 select * into p from public.publications where id=p_publication;
 if not found or p.project_id is null then raise exception 'Publication unavailable' using errcode='23514';end if;
 select * into c from public.publication_agent_projects where project_id=p.project_id and client_id=p.client_id;
 if not found or not c.enabled or not c.rights_confirmed then raise exception 'Preparation disabled' using errcode='55000';end if;
 select * into a from public.agents where id=c.agent_id for update;
 -- Serialize budget, then publication, then run: same lock order as finish/fail.
 select * into p from public.publications where id=p_publication for update;
 if not a.publication_specialist or not agent_scope_private.context_allowed(a.id,p.client_id,p.project_id) then raise exception 'Agent scope invalid' using errcode='23514';end if;
 key:=p.id::text||':'||coalesce(p_expected::text,'initial');
 select * into r from public.publication_ai_runs where idempotency_key=key order by attempt desc limit 1 for update;
 if found and r.status in('completed','processing') and (r.status='completed' or r.lease_until>now()) then return jsonb_build_object('run_id',r.id,'reused',true,'status',r.status);end if;
 for old in select * from public.publication_ai_runs where agent_id=a.id and status='processing' and lease_until<=now() for update loop
  update public.publication_ai_runs set status='failed',error_code='lease_expired',estimated_cost_eur=reserved_cost_eur where id=old.id;
  update public.agent_runs set status='failed',completed_at=now(),estimated_cost_eur=old.reserved_cost_eur,summary='Preparation expired; budget retained conservatively' where id=old.agent_run_id;
  update public.publication_drive_media set claimed_run_id=null where claimed_run_id=old.id and not exists(select 1 from public.publication_media_uses where media_id=publication_drive_media.id);
  insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata) values('system','publication.preparation_failed',old.client_id,'publication',old.publication_id,jsonb_build_object('run_id',old.id,'code','lease_expired'));
 end loop;
 if p.current_revision_id is distinct from p_expected or not (p.status='draft' and p.current_revision_id is null or p.status='rejected' and exists(select 1 from public.publication_reviews where revision_id=p_expected and decision='rejected' and length(btrim(reason))>0))
 or not exists(select 1 from public.publication_calendar_slots where publication_id=p.id and project_id=p.project_id and client_id=p.client_id) then raise exception 'Not an eligible calendar placeholder or refusal' using errcode='40001';end if;
 attempt:=coalesce(r.attempt,0)+1;if attempt>3 then raise exception 'Retry limit reached' using errcode='55000';end if;
 select coalesce(sum(case when status='processing' then reserved_cost_eur else estimated_cost_eur end),0) into spent from public.publication_ai_runs where agent_id=a.id and created_at>=date_trunc('month',now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
 if a.max_monthly_budget_eur is not null and spent+.1>a.max_monthly_budget_eur then raise exception 'Budget limit reached' using errcode='55000';end if;
 insert into public.agent_runs(agent_id,client_id,project_id,status,summary,metadata) values(a.id,p.client_id,p.project_id,'running','Manual Publications preparation',jsonb_build_object('publication_id',p.id,'manual',true)) returning id into agent_run;
 insert into public.publication_ai_runs(agent_run_id,agent_id,client_id,project_id,publication_id,expected_revision_id,idempotency_key,attempt)
 values(agent_run,a.id,p.client_id,p.project_id,p.id,p_expected,key,attempt) returning * into r;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor,'publication.preparation_started',p.client_id,'publication',p.id,jsonb_build_object('run_id',r.id));
 return jsonb_build_object('run_id',r.id,'reused',false,'status','processing');
end $$;
create function public.publication_ai_catalog(p_run uuid,p_photos jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_ai_runs;c public.publication_agent_projects;photo jsonb;media uuid;result jsonb:='[]';
begin
 select * into r from public.publication_ai_runs where id=p_run and status='processing' and lease_until>now() for update;if not found then raise exception 'Run invalid' using errcode='40001';end if;
 select * into c from public.publication_agent_projects where project_id=r.project_id and enabled;
 if not found or not agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id) or jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos)>100 then raise exception 'Catalog scope invalid' using errcode='23514';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  insert into public.publication_drive_media(client_id,drive_file_id,drive_folder_id,name,mime_type,modified_at,width,height,file_size)
  values(r.client_id,photo->>'drive_file_id',c.drive_folder_id,photo->>'name',photo->>'mime_type',(photo->>'modified_at')::timestamptz,(photo->>'width')::integer,(photo->>'height')::integer,(photo->>'size')::bigint)
  on conflict(client_id,drive_file_id) do nothing;
  select id into media from public.publication_drive_media where client_id=r.client_id and drive_file_id=photo->>'drive_file_id' and drive_folder_id=c.drive_folder_id;
  if media is not null then result:=result||jsonb_build_array(jsonb_build_object('drive_file_id',photo->>'drive_file_id','id',media,'used',exists(select 1 from public.publication_media_uses where media_id=media)));end if;
 end loop;
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata) values('system','publication.media_catalog_read',r.client_id,'publication',r.publication_id,jsonb_build_object('run_id',r.id,'count',jsonb_array_length(result)));return result;
end $$;
create function public.publication_ai_claim_media(p_run uuid,p_media uuid,p_hash text,p_analysis jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_ai_runs;m public.publication_drive_media;
begin
 select * into r from public.publication_ai_runs where id=p_run and status='processing' and lease_until>now() for update;if not found then raise exception 'Run invalid' using errcode='40001';end if;
 select * into m from public.publication_drive_media where id=p_media and client_id=r.client_id for update;
 if not found or m.claimed_run_id is not null and m.claimed_run_id<>r.id or exists(select 1 from public.publication_media_uses where media_id=m.id)
 or exists(select 1 from public.publication_assets a join public.publication_variant_assets v on v.asset_id=a.id where a.client_id=r.client_id and a.file_hash=p_hash)
 or not exists(select 1 from public.publication_agent_projects where project_id=r.project_id and client_id=r.client_id and enabled and rights_confirmed and drive_folder_id=m.drive_folder_id)
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_analysis) is distinct from 'object'
 or not agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id) then raise exception 'Media unavailable or reused' using errcode='23514';end if;
 update public.publication_drive_media set file_hash=p_hash,analysis=p_analysis,claimed_run_id=r.id where id=m.id;
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata) values('system','publication.media_reserved',r.client_id,'publication',r.publication_id,jsonb_build_object('media_id',m.id,'run_id',r.id));
end $$;
create function public.publication_ai_fail(p_run uuid,p_error text,p_cost numeric,p_input integer,p_output integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_ai_runs;
begin
 perform 1 from public.agents where id=(select agent_id from public.publication_ai_runs where id=p_run) for update;
 select * into r from public.publication_ai_runs where id=p_run and status='processing' for update;if not found then return;end if;
 update public.publication_ai_runs set status=case when p_error in('media_required','needs_review') then 'needs_review' else 'failed' end,error_code=p_error,estimated_cost_eur=p_cost,input_tokens=p_input,output_tokens=p_output where id=r.id;
 update public.agent_runs set status='failed',completed_at=now(),summary=p_error,input_tokens=p_input,output_tokens=p_output,estimated_cost_eur=p_cost where id=r.agent_run_id;
 update public.publication_drive_media set claimed_run_id=null where claimed_run_id=r.id and not exists(select 1 from public.publication_media_uses where media_id=publication_drive_media.id);
 insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata) values('system','publication.preparation_failed',r.client_id,'publication',r.publication_id,jsonb_build_object('run_id',r.id,'code',p_error));
end $$;
create function public.publication_ai_finish(p_run uuid,p_media uuid,p_content jsonb,p_opportunity jsonb,p_derivatives jsonb,p_original text,p_usage jsonb,p_actor text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_ai_runs;p public.publications;m public.publication_drive_media;revision uuid;variant uuid;item jsonb;channel text;asset uuid;
begin
 if p_actor is null or p_actor !~ '^user_[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid actor' using errcode='22023';end if;
 perform 1 from public.agents where id=(select agent_id from public.publication_ai_runs where id=p_run) for update;
 select * into r from public.publication_ai_runs where id=p_run for update;
 if r.status='completed' then return r.revision_id;end if;
 if r.id is null or r.status<>'processing' or r.lease_until<=now() then raise exception 'Run invalid' using errcode='40001';end if;
 select * into p from public.publications where id=r.publication_id for update;
 select * into m from public.publication_drive_media where id=p_media and client_id=r.client_id and claimed_run_id=r.id for update;
 if not found or exists(select 1 from public.publication_media_uses where media_id=m.id) or p.current_revision_id is distinct from r.expected_revision_id
 or p.status not in('draft','rejected') or not agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id)
 or not exists(select 1 from public.publication_agent_projects where project_id=r.project_id and client_id=r.client_id and enabled)
 or not exists(select 1 from public.publication_calendar_slots where publication_id=p.id)
 or (p_content->>'selected_asset_id') is distinct from m.id::text or p_opportunity->>'id' is null or (p_content->>'selected_opportunity') is distinct from (p_opportunity->>'id') then raise exception 'Preparation scope stale' using errcode='40001';end if;
 if jsonb_typeof(p_derivatives) is distinct from 'array' or jsonb_array_length(p_derivatives)<>(case when publications_private.project_platform_allowed(p.project_id,p.client_id,'facebook') then 2 else 1 end) then raise exception 'Missing derivatives' using errcode='23514';end if;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',p_content->>'internal_title','angle',p_content->>'subject','source',p_content->>'source_content','target_date',p.target_date,'actor',p_actor,'project',p.project_id)::text,true);
 insert into public.publication_revisions(publication_id,client_id,project_id,revision_number,parent_revision_id,origin,regeneration_reason,model,estimated_cost)
 values(p.id,p.client_id,p.project_id,coalesce((select max(revision_number)+1 from public.publication_revisions where publication_id=p.id),1),p.current_revision_id,case when p.status='rejected' then 'regenerated' else 'generated' end,
 case when p.status='rejected' then (select reason from public.publication_reviews where revision_id=p.current_revision_id and decision='rejected' limit 1) end,r.model,(p_usage->>'estimated_cost_eur')::numeric) returning id into revision;
 for item in select value from jsonb_array_elements(p_derivatives) loop
  channel:=item->>'platform';asset:=(item->>'asset_id')::uuid;
  if not publications_private.project_platform_allowed(p.project_id,p.client_id,channel) or p_content->channel->>'text' is null then raise exception 'Platform invalid' using errcode='23514';end if;
  insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
  values(asset,p.client_id,item->>'path',item->>'hash','image/jpeg',(item->>'width')::integer,(item->>'height')::integer,'Client Drive photo derivative',true) on conflict(id) do nothing;
  -- Identical social derivatives share one asset, but existing foreign assets cannot be reused.
  if not exists(select 1 from public.publication_assets a where a.id=asset and a.client_id=p.client_id and a.file_hash=item->>'hash' and a.storage_path=item->>'path' and a.created_at>=r.created_at)
  or exists(select 1 from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where va.asset_id=asset and v.revision_id<>revision) then raise exception 'Asset scope invalid' using errcode='23514';end if;
  insert into public.publication_variants(publication_id,client_id,revision_id,platform,text_content,metadata)
  values(p.id,p.client_id,revision,channel,p_content->channel->>'text',jsonb_strip_nulls(jsonb_build_object('title',p_content->channel->>'title','cta',p_content->channel->>'cta'))) returning id into variant;
  insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(variant,asset,p.client_id,0);
  insert into public.publication_media_uses(media_id,asset_id,publication_id,revision_id,client_id,platform) values(m.id,asset,p.id,revision,p.client_id,channel);
 end loop;
 if p_original is null or p_original not like p.client_id::text||'/'||p.id::text||'/%' or p_original ~ '(\.\.|://|\\)' then raise exception 'Original path invalid' using errcode='23514';end if;
 update public.publication_drive_media set original_path=p_original where id=m.id;
 insert into public.publication_generation_details(revision_id,publication_id,client_id,run_id,selected_opportunity,media_id,factual_basis,generation_summary)
 values(revision,p.id,p.client_id,r.id,p_opportunity,m.id,p_content->'factual_basis',p_content->>'generation_summary');
 update public.publications set subject=p_content->>'internal_title',status='pending_review',current_revision_id=revision where id=p.id;
 update public.publication_ai_runs set status='completed',revision_id=revision,estimated_cost_eur=(p_usage->>'estimated_cost_eur')::numeric,input_tokens=(p_usage->>'input_tokens')::integer,output_tokens=(p_usage->>'output_tokens')::integer where id=r.id;
 update public.agent_runs set status='completed',completed_at=now(),summary='Prepared for human review',metadata=metadata||jsonb_build_object('model',r.model,'revision_id',revision),input_tokens=(p_usage->>'input_tokens')::integer,output_tokens=(p_usage->>'output_tokens')::integer,estimated_cost_eur=(p_usage->>'estimated_cost_eur')::numeric where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata) values('admin',p_actor,'publication.ai_prepared',p.client_id,'publication',p.id,jsonb_build_object('run_id',r.id,'revision_id',revision,'media_id',m.id));
 perform set_config('codev.publication_editorial','',true);return revision;
end $$;
revoke all on function public.publication_agent_configure(uuid,text,jsonb,text,boolean,boolean,text),public.publication_ai_begin(uuid,uuid,text),public.publication_ai_catalog(uuid,jsonb),public.publication_ai_claim_media(uuid,uuid,text,jsonb),public.publication_ai_fail(uuid,text,numeric,integer,integer),public.publication_ai_finish(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_agent_configure(uuid,text,jsonb,text,boolean,boolean,text),public.publication_ai_begin(uuid,uuid,text),public.publication_ai_catalog(uuid,jsonb),public.publication_ai_claim_media(uuid,uuid,text,jsonb),public.publication_ai_fail(uuid,text,numeric,integer,integer),public.publication_ai_finish(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,text) to service_role;
