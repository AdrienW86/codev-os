-- Choix du modèle par agent (lot 0 du socle éditorial) : une préparation Publications rédigée par Claude Opus 5.5
-- coûte plus que l'ancien plafond de 0,10 € par exécution (réflexion + rédaction + photo en meilleure résolution).
-- Plafond par exécution porté à 2 € ; le reste (réservation, budget mensuel de l'agent, verrous) est inchangé.
-- À appliquer AVANT d'ajouter ANTHROPIC_API_KEY dans Vercel : sinon une préparation coûtant plus de 0,10 € est refusée.
alter table public.publication_agent_v2_runs drop constraint if exists publication_agent_v2_runs_estimated_cost_eur_check;
alter table public.publication_agent_v2_runs add constraint publication_agent_v2_runs_estimated_cost_eur_check check(estimated_cost_eur between 0 and 2);

-- Même fonction que 20261029000000 (dernière version), seul le plafond de coût change.
create or replace function public.publication_agent_v2_finish(p_run_id uuid,p_output jsonb,p_media_id uuid,p_usage jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;a public.whatsapp_assets;item jsonb;subject text;angle text;created jsonb;group_id uuid;ids uuid[]:=array[]::uuid[];seen uuid[]:=array[]::uuid[];
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
  or tokens_in<0 or tokens_out<0 or cost<0 or cost>2 then raise exception 'Invalid agent output' using errcode='22023'; end if;
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
 if p_media_id is not null then
  select * into m from public.publication_drive_media where id=p_media_id and client_id=r.client_id for update;
  if found then
   r.selected_media_id:=p_media_id;
   if not publications_private.agent_v2_media_available(r,m) or m.claimed_agent_v2_run_id is not null then
    raise exception 'Invalid agent media' using errcode='22023'; end if;
  else
   -- Photothèque du client (WhatsApp, export, dossier Drive) : mêmes garanties, règles de réemploi du client.
   select * into a from public.whatsapp_assets where id=p_media_id and client_id=r.client_id for update;
   r.selected_library_asset_id:=p_media_id;
   if not publications_private.agent_v2_library_available(r,a) or a.claimed_agent_v2_run_id is not null then
    raise exception 'Invalid agent media' using errcode='22023'; end if;
  end if;
 end if;
 for item in select value from jsonb_array_elements(p_output->'publications') order by value->>'occurrence_id' loop
  created:=publications_private.create_publication_from_occurrence((item->>'occurrence_id')::uuid,group_id,
   case when group_id is null and cardinality(r.occurrence_ids)>1 then subject end,subject,angle,item->>'text',
   case when jsonb_typeof(item->'cta')='string' and btrim(item->>'cta')<>'' then jsonb_build_object('cta',btrim(item->>'cta')) else '{}'::jsonb end,p_actor_id,'agent');
  group_id:=coalesce(group_id,(created->>'editorial_group_id')::uuid);ids:=ids||(created->>'publication_id')::uuid;
 end loop;
 update public.publication_agent_v2_runs set status='completed',completed_at=now(),publication_ids=ids,editorial_group_id=group_id,selected_media_id=r.selected_media_id,selected_library_asset_id=r.selected_library_asset_id,
  input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost,media_status=case when p_media_id is null then 'none' else 'pending' end where id=r.id;
 if r.selected_media_id is not null then update public.publication_drive_media set claimed_agent_v2_run_id=r.id where id=r.selected_media_id; end if;
 if r.selected_library_asset_id is not null then update public.whatsapp_assets set claimed_agent_v2_run_id=r.id where id=r.selected_library_asset_id and client_id=r.client_id; end if;
 update public.agent_runs set status='completed',completed_at=now(),summary='Prepared drafts for human review',input_tokens=tokens_in,output_tokens=tokens_out,estimated_cost_eur=cost,
  metadata=metadata||jsonb_build_object('agent_v2_run_id',r.id,'publications',cardinality(ids)) where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_completed',r.client_id,'project',r.project_id,
  jsonb_build_object('run_id',r.id,'project_id',r.project_id,'occurrence_ids',to_jsonb(r.occurrence_ids),'publication_ids',to_jsonb(ids),
   'editorial_group_id',group_id,'with_media',p_media_id is not null,'media_source',case when r.selected_library_asset_id is not null then 'library' when r.selected_media_id is not null then 'catalog' end));
 return jsonb_build_object('run_id',r.id,'publication_ids',to_jsonb(ids),'editorial_group_id',group_id,'media_status',case when p_media_id is null then 'none' else 'pending' end);
end $$;

-- Même fonction que 20261008040000, seul le plafond de coût change.
create or replace function public.publication_agent_v2_fail(p_run_id uuid,p_error_code text,p_usage jsonb,p_actor_id text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;cost numeric:=coalesce((p_usage->>'estimated_cost_eur')::numeric,0);
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null
  or p_error_code is null or p_error_code not in('invalid_output','unsupported_claim','occurrence_unavailable','generation_failed','context_unavailable')
  or jsonb_typeof(p_usage) is distinct from 'object' or cost<0 or cost>2 then raise exception 'Invalid agent failure' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'processing' then raise exception 'Agent run not active' using errcode='55000'; end if;
 update public.publication_agent_v2_runs set status='failed',error_code=p_error_code,completed_at=now(),estimated_cost_eur=cost,
  input_tokens=greatest(coalesce((p_usage->>'input_tokens')::integer,0),0),output_tokens=greatest(coalesce((p_usage->>'output_tokens')::integer,0),0) where id=r.id;
 update public.agent_runs set status='failed',completed_at=now(),summary=p_error_code,estimated_cost_eur=cost where id=r.agent_run_id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_failed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'project_id',r.project_id,'code',p_error_code));
end $$;
