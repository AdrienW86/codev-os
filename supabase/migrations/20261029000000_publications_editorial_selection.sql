-- Socle Publications, lots 4-5 : sélection éditoriale conjointe sujet + photo dans la photothèque du client.
-- L'Agent Publications v2 reste le seul moteur : il peut désormais choisir une photo de la photothèque
-- (whatsapp_assets : WhatsApp, export, dossier Drive) en plus du catalogue Drive historique. Mêmes garanties :
-- réservation par le run, contrôle serveur au moment de finir, de réserver et d'attacher, attache atomique.
-- Une photo confidentielle, en quarantaine, rejetée, archivée, purgée ou jugée hors sujet n'est jamais choisie ;
-- le réemploi suit le réglage du client (désactivé par défaut). Nouvelle catégorie de notification « Photo manquante ».
-- Forward-only. Aucune publication, aucune soumission, aucune approbation.

-- 1. Sélection d'une photo de la photothèque par un run (exclusive du catalogue Drive).
alter table public.publication_agent_v2_runs
 add column selected_library_asset_id uuid,
 add constraint publication_agent_v2_runs_library_fk foreign key(selected_library_asset_id,client_id) references public.whatsapp_assets(id,client_id) on delete restrict,
 add constraint publication_agent_v2_runs_single_source check(selected_media_id is null or selected_library_asset_id is null),
 drop constraint publication_agent_v2_runs_media_scope,
 drop constraint publication_agent_v2_runs_media_selected;
alter table public.publication_agent_v2_runs
 add constraint publication_agent_v2_runs_media_scope check(media_status='none' or (status='completed' and coalesce(selected_media_id,selected_library_asset_id) is not null)),
 add constraint publication_agent_v2_runs_media_selected check(status<>'completed' or coalesce(selected_media_id,selected_library_asset_id) is null or media_status<>'none');
create index publication_agent_v2_runs_library on public.publication_agent_v2_runs(selected_library_asset_id) where selected_library_asset_id is not null;

alter table public.whatsapp_assets
 add column claimed_agent_v2_run_id uuid,
 add constraint whatsapp_assets_agent_v2_claim_fk foreign key(claimed_agent_v2_run_id,client_id) references public.publication_agent_v2_runs(id,client_id) on delete restrict;
create index whatsapp_assets_agent_v2_claim on public.whatsapp_assets(claimed_agent_v2_run_id) where claimed_agent_v2_run_id is not null;
create index whatsapp_asset_uses_history on public.whatsapp_asset_uses(client_id,asset_id,used_at);

-- 2. Règles partagées (miroir SQL de isPublicationCandidate, lib/media-intelligence/model.ts).
-- Décision humaine d'abord ; sinon évaluation IA prudente (pertinent, sans visage ni mineur). Jamais confidentiel.
create function publications_private.library_asset_publishable(a public.whatsapp_assets) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(a.id is not null and a.media_kind='image' and a.purged_at is null and a.imported_at is not null
  and a.library_status in('received','to_review','validated','used')
  and not exists(select 1 from public.whatsapp_asset_assessments s where s.asset_id=a.id and s.client_id=a.client_id and (s.confidential or s.manual_verdict='off_topic'))
  and (a.library_status in('validated','used')
   or exists(select 1 from public.whatsapp_asset_assessments s where s.asset_id=a.id and s.client_id=a.client_id
    and s.verdict='relevant' and not (s.sensitive && array['face','minor']))),false);
$$;
-- Réemploi : jamais utilisée, ou réemploi autorisé par le client et dernière utilisation plus ancienne que son délai.
create function publications_private.library_asset_reusable(a public.whatsapp_assets) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(not exists(select 1 from public.whatsapp_asset_uses u where u.asset_id=a.id and u.client_id=a.client_id)
  or exists(select 1 from public.publication_client_settings c where c.client_id=a.client_id and c.media_reuse_allowed
   and not exists(select 1 from public.whatsapp_asset_uses u where u.asset_id=a.id and u.client_id=a.client_id
    and u.used_at>now()-make_interval(days=>c.media_reuse_after_days))),false);
$$;
-- Garde serveur des RPC de média pour une photo de la photothèque : sélection du run, même client, image acceptée
-- de 8 Mo au plus, publiable, réemploi permis, non réservée par un autre run, agent du projet actif avec droits confirmés.
create function publications_private.agent_v2_library_available(r public.publication_agent_v2_runs,a public.whatsapp_assets) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(a.id is not null and a.id=r.selected_library_asset_id and a.client_id=r.client_id
  and a.mime_type in('image/jpeg','image/png','image/webp') and a.size between 1 and 8388608
  and (a.claimed_agent_v2_run_id is null or a.claimed_agent_v2_run_id=r.id)
  and publications_private.library_asset_publishable(a) and publications_private.library_asset_reusable(a)
  and exists(select 1 from public.publication_agent_projects c where c.project_id=r.project_id and c.client_id=r.client_id and c.enabled and c.rights_confirmed)
  and agent_scope_private.context_allowed(r.agent_id,r.client_id,r.project_id),false);
$$;

-- 3. Le run reste immuable une fois clos, sélection de la photothèque comprise.
create or replace function publications_private.guard_agent_v2_run() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.agent_run_id,new.agent_id,new.client_id,new.project_id,new.occurrence_ids,new.considered_count,new.created_at,new.reserved_cost_eur)
    is distinct from (old.id,old.agent_run_id,old.agent_id,old.client_id,old.project_id,old.occurrence_ids,old.considered_count,old.created_at,old.reserved_cost_eur) then
  raise exception 'Agent run is immutable' using errcode='55000'; end if;
 if old.status='processing' then
  if new.media_attempts<>0 or new.media_lease_until is not null or new.media_status not in('none','pending') then
   raise exception 'Agent run is immutable' using errcode='55000'; end if;
  return new; end if;
 if old.status<>'completed'
  or (new.status,new.completed_at,new.selected_media_id,new.selected_library_asset_id,new.editorial_group_id,new.publication_ids,new.estimated_cost_eur,new.input_tokens,new.output_tokens,new.model,new.error_code,new.lease_until)
   is distinct from (old.status,old.completed_at,old.selected_media_id,old.selected_library_asset_id,old.editorial_group_id,old.publication_ids,old.estimated_cost_eur,old.input_tokens,old.output_tokens,old.model,old.error_code,old.lease_until)
  or (old.media_status,new.media_status) not in(('pending','pending'),('pending','attached'),('pending','needs_media'),('needs_media','pending'))
  or new.media_attempts<old.media_attempts then
  raise exception 'Agent run is immutable' using errcode='55000'; end if;
 return new;
end $$;

-- 4. Finir, réserver, attacher, échouer : mêmes signatures, photothèque ou catalogue Drive.
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

create or replace function public.publication_agent_v2_media_claim(p_run_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;a public.whatsapp_assets;descriptor jsonb;p public.publications;variant uuid;targets jsonb:='[]'::jsonb;pid uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null then raise exception 'Invalid media request' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where publication_agent_v2_runs.id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status='attached' then return jsonb_build_object('run_id',r.id,'media_status','attached','attempt',r.media_attempts); end if;
 if r.media_status='pending' and r.media_lease_until>now() then raise exception 'Media step in progress' using errcode='55P03'; end if;
 if r.selected_library_asset_id is not null then
  select * into a from public.whatsapp_assets where whatsapp_assets.id=r.selected_library_asset_id and client_id=r.client_id for update;
  if not publications_private.agent_v2_library_available(r,a) then raise exception 'Media unavailable' using errcode='23514'; end if;
  descriptor:=jsonb_build_object('id',a.id,'source','library','origin',a.origin,'drive_file_id',a.drive_file_id,'drive_folder_id',a.drive_folder_id,'mime_type',a.mime_type,'file_size',a.size,'md5',a.md5);
 else
  select * into m from public.publication_drive_media where publication_drive_media.id=r.selected_media_id and client_id=r.client_id for update;
  if not publications_private.agent_v2_media_available(r,m) then raise exception 'Media unavailable' using errcode='23514'; end if;
  descriptor:=jsonb_build_object('id',m.id,'source','catalog','drive_file_id',m.drive_file_id,'drive_folder_id',m.drive_folder_id,'mime_type',m.mime_type,'file_size',m.file_size);
 end if;
 foreach pid in array (select array_agg(x order by x) from unnest(r.publication_ids) x) loop
  select * into p from public.publications where publications.id=pid for update;
  variant:=publications_private.agent_v2_media_target(r,p);
  if variant is null then raise exception 'Media target unavailable' using errcode='23514'; end if;
  targets:=targets||jsonb_build_array(jsonb_build_object('publication_id',p.id,'revision_id',p.current_revision_id,'variant_id',variant,'platform',p.platform));
 end loop;
 if a.id is not null then update public.whatsapp_assets set claimed_agent_v2_run_id=r.id where whatsapp_assets.id=a.id and claimed_agent_v2_run_id is distinct from r.id;
 else update public.publication_drive_media set claimed_agent_v2_run_id=r.id where publication_drive_media.id=m.id and claimed_agent_v2_run_id is distinct from r.id; end if;
 update public.publication_agent_v2_runs set media_status='pending',media_error_code=null,media_attempts=media_attempts+1,media_lease_until=now()+interval '10 minutes'
  where publication_agent_v2_runs.id=r.id returning * into r;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_claimed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'media_id',coalesce(a.id,m.id),'attempt',r.media_attempts));
 return jsonb_build_object('run_id',r.id,'media_status','pending','attempt',r.media_attempts,'client_id',r.client_id,
  'media',descriptor,'targets',targets);
end $$;

create or replace function public.publication_agent_v2_media_attach(p_run_id uuid,p_attempt integer,p_original_hash text,p_assets jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;m public.publication_drive_media;lib public.whatsapp_assets;p public.publications;item jsonb;variant uuid;asset uuid;seen uuid[]:=array[]::uuid[];assets uuid[]:=array[]::uuid[];
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_attempt is null or p_attempt<1
  or p_original_hash is null or p_original_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_assets) is distinct from 'array' then
  raise exception 'Invalid media attachment' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status='attached' and r.media_attempts=p_attempt then
  return jsonb_build_object('run_id',r.id,'media_status','attached','publication_ids',to_jsonb(r.publication_ids),'replayed',true); end if;
 if r.media_status<>'pending' or r.media_attempts<>p_attempt then raise exception 'Stale media attempt' using errcode='40001'; end if;
 if r.selected_library_asset_id is not null then
  -- Photothèque : l'empreinte SHA-256 de l'original est toujours connue et doit correspondre exactement.
  select * into lib from public.whatsapp_assets where id=r.selected_library_asset_id and client_id=r.client_id for update;
  if not publications_private.agent_v2_library_available(r,lib) or lib.claimed_agent_v2_run_id is distinct from r.id or lib.sha256<>p_original_hash then
   raise exception 'Media unavailable' using errcode='23514'; end if;
 else
  select * into m from public.publication_drive_media where id=r.selected_media_id and client_id=r.client_id for update;
  if not publications_private.agent_v2_media_available(r,m) or m.claimed_agent_v2_run_id is distinct from r.id
   or (m.file_hash is not null and m.file_hash<>p_original_hash) then raise exception 'Media unavailable' using errcode='23514'; end if;
 end if;
 if jsonb_array_length(p_assets)<>cardinality(r.publication_ids) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assets) order by value->>'publication_id' loop
  if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k)
    is distinct from array['asset_id','file_hash','height','mime_type','publication_id','storage_path','width']
   or jsonb_typeof(item->'publication_id') is distinct from 'string' or jsonb_typeof(item->'asset_id') is distinct from 'string'
   or jsonb_typeof(item->'width') is distinct from 'number' or jsonb_typeof(item->'height') is distinct from 'number' then
   raise exception 'Invalid media attachment' using errcode='22023'; end if;
  select * into p from public.publications where id=(item->>'publication_id')::uuid for update;
  if p.id is null or p.id=any(seen) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
  seen:=seen||p.id;variant:=publications_private.agent_v2_media_target(r,p);asset:=(item->>'asset_id')::uuid;
  if variant is null then raise exception 'Media target unavailable' using errcode='23514'; end if;
  if item->>'storage_path' is distinct from p.client_id::text||'/'||p.id::text||'/'||asset::text then raise exception 'Invalid media path' using errcode='23514'; end if;
  insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
  values(asset,p.client_id,item->>'storage_path',item->>'file_hash',item->>'mime_type',(item->>'width')::integer,(item->>'height')::integer,
   case when lib.id is not null then 'Photothèque client — Agent Publications v2' else 'Photo client (Drive) — Agent Publications v2' end,true);
  insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
  values(variant,asset,p.client_id,coalesce((select max(sort_order)+1 from public.publication_variant_assets where variant_id=variant),0));
  if lib.id is not null then
   insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,publication_asset_id,used_by) values(lib.id,p.client_id,p.id,p.platform,asset,p_actor_id);
  else
   insert into public.publication_media_uses(media_id,asset_id,publication_id,revision_id,client_id,platform) values(m.id,asset,p.id,p.current_revision_id,p.client_id,p.platform);
  end if;
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
  values('admin',p_actor_id,'publication.media_attached',p.client_id,'publication',p.id,
   jsonb_build_object('run_id',r.id,'media_id',coalesce(lib.id,m.id),'asset_id',asset,'revision_id',p.current_revision_id,'platform',p.platform));
  assets:=assets||asset;
 end loop;
 if cardinality(seen)<>cardinality(r.publication_ids) then raise exception 'Invalid media attachment' using errcode='22023'; end if;
 if lib.id is not null then
  update public.whatsapp_assets set claimed_agent_v2_run_id=null,library_status='used',status_changed_at=now(),status_changed_by=p_actor_id where id=lib.id and client_id=r.client_id;
 else
  update public.publication_drive_media set file_hash=coalesce(file_hash,p_original_hash),claimed_agent_v2_run_id=null where id=m.id;
 end if;
 update public.publication_agent_v2_runs set media_status='attached',media_attached_at=now(),media_lease_until=null,media_error_code=null where id=r.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_attached',r.client_id,'project',r.project_id,
  jsonb_build_object('run_id',r.id,'media_id',coalesce(lib.id,m.id),'attempt',p_attempt,'publication_ids',to_jsonb(r.publication_ids)));
 return jsonb_build_object('run_id',r.id,'media_status','attached','publication_ids',to_jsonb(r.publication_ids),'asset_ids',to_jsonb(assets),'replayed',false);
end $$;

create or replace function public.publication_agent_v2_media_fail(p_run_id uuid,p_attempt integer,p_error_code text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_attempt is null or p_attempt<0
  or p_error_code is null or p_error_code not in('media_unavailable','fetch_failed','invalid_media','upload_failed','attach_failed') then
  raise exception 'Invalid media failure' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if not found or r.status<>'completed' or r.media_status='none' then raise exception 'Media step unavailable' using errcode='55000'; end if;
 if r.media_status in('attached','needs_media') then return jsonb_build_object('run_id',r.id,'media_status',r.media_status); end if;
 if r.media_attempts<>p_attempt then raise exception 'Stale media attempt' using errcode='40001'; end if;
 update public.publication_agent_v2_runs set media_status='needs_media',media_error_code=p_error_code,media_lease_until=null where id=r.id;
 update public.publication_drive_media set claimed_agent_v2_run_id=null where id=r.selected_media_id and claimed_agent_v2_run_id=r.id;
 update public.whatsapp_assets set claimed_agent_v2_run_id=null where id=r.selected_library_asset_id and client_id=r.client_id and claimed_agent_v2_run_id=r.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.agent_v2_media_failed',r.client_id,'project',r.project_id,jsonb_build_object('run_id',r.id,'attempt',p_attempt,'code',p_error_code));
 return jsonb_build_object('run_id',r.id,'media_status','needs_media');
end $$;

-- 5. Notification « Photo manquante » (aucun média adapté pour une préparation) : vers la photothèque du client.
alter table public.admin_notifications drop constraint admin_notifications_category_check;
alter table public.admin_notifications add constraint admin_notifications_category_check
  check (category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing'));
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_categories_check;
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_push_categories_check;
alter table public.admin_notification_preferences
  add constraint admin_notification_preferences_categories_check check (categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing']),
  add constraint admin_notification_preferences_push_categories_check check (push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing']),
  alter column categories set default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing'];
update public.admin_notification_preferences set categories = array_append(categories, 'media_missing') where not ('media_missing' = any(categories));
create or replace function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;

-- 6. Droits : service_role uniquement.
revoke all on function publications_private.library_asset_publishable(public.whatsapp_assets),publications_private.library_asset_reusable(public.whatsapp_assets),
 publications_private.agent_v2_library_available(public.publication_agent_v2_runs,public.whatsapp_assets) from public,anon,authenticated,service_role;
grant execute on function publications_private.library_asset_publishable(public.whatsapp_assets),publications_private.library_asset_reusable(public.whatsapp_assets),
 publications_private.agent_v2_library_available(public.publication_agent_v2_runs,public.whatsapp_assets) to service_role;
notify pgrst, 'reload schema';
