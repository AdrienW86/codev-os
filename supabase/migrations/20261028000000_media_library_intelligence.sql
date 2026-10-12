-- Socle Publications multiclient, lot 2 : photothèque intelligente par client. Migration additive.
-- 1. Profil média du client : activité, prestations, photos acceptées / exclues, sujets prioritaires, consignes,
--    budget IA mensuel, quarantaine et politique de suppression (toujours après décision humaine).
-- 2. Photothèque : origine des médias (WhatsApp, dossier Drive de la photothèque, export WhatsApp), date d'origine,
--    statuts « quarantaine » (posé par l'IA ou un humain) et « rejeté » (posé uniquement par un humain), purge tracée.
-- 3. Évaluations IA : pertinence métier et aptitude à publier séparées, éléments sensibles, confidentialité,
--    description neutre ; journal des coûts IA (budget mensuel par client).
-- Aucune ligne existante n'est modifiée ; aucun fichier n'est supprimé par la base.

-- 1. Profil média du client.
create table public.client_media_profiles (
  client_id uuid primary key references public.clients(id) on delete restrict,
  activity_summary text not null default '' check (length(activity_summary) <= 2000),
  services text[] not null default '{}' check (cardinality(services) <= 30),
  accepted_photo_types text[] not null default '{}' check (cardinality(accepted_photo_types) <= 30),
  excluded_photo_types text[] not null default '{}' check (cardinality(excluded_photo_types) <= 30),
  priority_topics text[] not null default '{}' check (cardinality(priority_topics) <= 30),
  communication_guidelines text not null default '' check (length(communication_guidelines) <= 4000),
  ai_classification_enabled boolean not null default false,
  ai_monthly_budget_eur numeric(6,2) not null default 2.00 check (ai_monthly_budget_eur between 0 and 50),
  quarantine_retention_days smallint not null default 30 check (quarantine_retention_days between 7 and 365),
  rejected_deletion_policy text not null default 'keep' check (rejected_deletion_policy in ('keep','trash_drive')),
  version integer not null default 1 check (version >= 1),
  updated_by text not null check (updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  updated_at timestamptz not null default now()
);
create function codev_private.media_profile_list_valid(p_items text[]) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(bool_and(length(btrim(i)) between 2 and 120 and i !~ '[\x00-\x1f]'),true) from unnest(p_items) i;
$$;
alter table public.client_media_profiles add constraint client_media_profiles_lists check (
  codev_private.media_profile_list_valid(services) and codev_private.media_profile_list_valid(accepted_photo_types)
  and codev_private.media_profile_list_valid(excluded_photo_types) and codev_private.media_profile_list_valid(priority_topics));

create function public.client_media_profile_save(p_client_id uuid,p_profile jsonb,p_actor_id text)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare saved public.client_media_profiles;existed boolean;
 allowed constant text[]:=array['activity_summary','services','accepted_photo_types','excluded_photo_types','priority_topics','communication_guidelines',
  'ai_classification_enabled','ai_monthly_budget_eur','quarantine_retention_days','rejected_deletion_policy'];
 list_keys constant text[]:=array['services','accepted_photo_types','excluded_photo_types','priority_topics'];
 k text;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_profile is null or jsonb_typeof(p_profile)<>'object'
  or exists(select 1 from jsonb_object_keys(p_profile) x where x<>all(allowed)) then raise exception 'Invalid media profile' using errcode='22023'; end if;
 foreach k in array list_keys loop
  if p_profile ? k and (jsonb_typeof(p_profile->k)<>'array' or exists(select 1 from jsonb_array_elements(p_profile->k) e where jsonb_typeof(e)<>'string')) then
   raise exception 'Invalid media profile' using errcode='22023'; end if;
 end loop;
 if (p_profile ? 'ai_classification_enabled' and jsonb_typeof(p_profile->'ai_classification_enabled')<>'boolean')
  or (p_profile ? 'ai_monthly_budget_eur' and jsonb_typeof(p_profile->'ai_monthly_budget_eur')<>'number')
  or (p_profile ? 'quarantine_retention_days' and jsonb_typeof(p_profile->'quarantine_retention_days')<>'number')
  or exists(select 1 from unnest(array['activity_summary','communication_guidelines','rejected_deletion_policy']) t where p_profile ? t and jsonb_typeof(p_profile->t)<>'string') then
  raise exception 'Invalid media profile' using errcode='22023'; end if;
 if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Invalid client' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('client_media_profile:'||p_client_id::text,0));
 existed:=exists(select 1 from public.client_media_profiles where client_id=p_client_id);
 if not existed then insert into public.client_media_profiles(client_id,updated_by) values(p_client_id,p_actor_id); end if;
 update public.client_media_profiles set
  activity_summary=coalesce(btrim(p_profile->>'activity_summary'),activity_summary),
  services=coalesce((select array_agg(btrim(e)) from jsonb_array_elements_text(p_profile->'services') e where btrim(e)<>''),case when p_profile ? 'services' then '{}'::text[] else services end),
  accepted_photo_types=coalesce((select array_agg(btrim(e)) from jsonb_array_elements_text(p_profile->'accepted_photo_types') e where btrim(e)<>''),case when p_profile ? 'accepted_photo_types' then '{}'::text[] else accepted_photo_types end),
  excluded_photo_types=coalesce((select array_agg(btrim(e)) from jsonb_array_elements_text(p_profile->'excluded_photo_types') e where btrim(e)<>''),case when p_profile ? 'excluded_photo_types' then '{}'::text[] else excluded_photo_types end),
  priority_topics=coalesce((select array_agg(btrim(e)) from jsonb_array_elements_text(p_profile->'priority_topics') e where btrim(e)<>''),case when p_profile ? 'priority_topics' then '{}'::text[] else priority_topics end),
  communication_guidelines=coalesce(btrim(p_profile->>'communication_guidelines'),communication_guidelines),
  ai_classification_enabled=coalesce((p_profile->>'ai_classification_enabled')::boolean,ai_classification_enabled),
  ai_monthly_budget_eur=coalesce((p_profile->>'ai_monthly_budget_eur')::numeric,ai_monthly_budget_eur),
  quarantine_retention_days=coalesce((p_profile->>'quarantine_retention_days')::smallint,quarantine_retention_days),
  rejected_deletion_policy=coalesce(p_profile->>'rejected_deletion_policy',rejected_deletion_policy),
  version=case when existed then version+1 else version end,updated_by=p_actor_id,updated_at=now()
 where client_id=p_client_id returning * into saved;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('media.profile_saved','admin',p_actor_id,'client',p_client_id,jsonb_build_object('version',saved.version,'ai_classification_enabled',saved.ai_classification_enabled,
  'ai_monthly_budget_eur',saved.ai_monthly_budget_eur,'quarantine_retention_days',saved.quarantine_retention_days,'rejected_deletion_policy',saved.rejected_deletion_policy,'created',not existed));
 return saved.version;
end $$;

-- 2. Photothèque : origine, date d'origine, quarantaine, rejet humain et purge.
alter table public.whatsapp_assets drop constraint whatsapp_assets_library_status_check;
alter table public.whatsapp_assets add constraint whatsapp_assets_library_status_check
  check (library_status in ('received','to_review','validated','used','archived','quarantined','rejected'));
alter table public.whatsapp_assets
  add column origin text not null default 'whatsapp' check (origin in ('whatsapp','drive','whatsapp_export')),
  add column captured_at timestamptz,
  add column purged_at timestamptz,
  -- « Rejeté » est une décision humaine (jamais l'IA) : la purge éventuelle ne s'applique qu'à elle.
  add constraint whatsapp_assets_rejected_by_human check (library_status<>'rejected' or status_changed_by ~ '^user_[a-zA-Z0-9_-]{1,200}$');
create index whatsapp_assets_rejected on public.whatsapp_assets (status_changed_at) where library_status='rejected' and purged_at is null;

-- 3. Évaluations IA (une évaluation courante par média) et journal des coûts.
create table public.whatsapp_asset_assessments (
  asset_id uuid primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  verdict text not null check (verdict in ('relevant','to_review','off_topic')),
  business_relevance numeric(3,2) not null check (business_relevance between 0 and 1),
  publishability numeric(3,2) not null check (publishability between 0 and 1),
  sensitive text[] not null default '{}' check (sensitive <@ array['face','minor','personal_document','invoice','address','license_plate','screen','other_private']::text[]),
  confidential boolean not null,
  description text not null check (length(description) between 1 and 400),
  topics text[] not null default '{}' check (cardinality(topics) <= 8),
  quality text not null check (quality in ('good','acceptable','poor')),
  quality_issues text[] not null default '{}' check (quality_issues <@ array['blurry','dark','low_resolution','watermark','screenshot','text_heavy','cropped']::text[]),
  profile_version integer not null,
  model text not null check (length(model) between 1 and 100),
  estimated_cost_eur numeric(8,6) not null check (estimated_cost_eur between 0 and 1),
  analyzed_at timestamptz not null default now(),
  manual_verdict text check (manual_verdict in ('relevant','off_topic')),
  reviewed_by text check (reviewed_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  reviewed_at timestamptz,
  -- Confidentiel ⇒ jamais « pertinent » : un document privé n'est pas un candidat à publication.
  check (not confidential or verdict<>'relevant'),
  foreign key (asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete restrict
);
create index whatsapp_asset_assessments_client on public.whatsapp_asset_assessments (client_id, verdict);
create table public.client_media_ai_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  asset_id uuid,
  purpose text not null check (purpose in ('classification')),
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  estimated_cost_eur numeric(8,6) not null check (estimated_cost_eur between 0 and 1),
  created_at timestamptz not null default now()
);
create index client_media_ai_usage_month on public.client_media_ai_usage (client_id, created_at desc);

create function public.client_media_ai_month_spend(p_client_id uuid) returns numeric
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(sum(estimated_cost_eur),0) from public.client_media_ai_usage
 where client_id=p_client_id and created_at>=date_trunc('month',now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
$$;

-- Enregistre une évaluation et son coût, puis applique la seule transition automatique autorisée :
-- reçu / à examiner → quarantaine (hors sujet ou confidentiel) ou → à examiner. Un statut posé par un humain
-- (validé, utilisé, archivé, rejeté, ou toute décision manuelle) n'est jamais modifié par l'IA.
create function public.whatsapp_asset_assessment_record(p_asset_id uuid,p_client_id uuid,p_assessment jsonb,p_usage jsonb)
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.whatsapp_assets;verdict text;confidential boolean;next_status text;cost numeric;
begin
 if p_assessment is null or jsonb_typeof(p_assessment)<>'object' or p_usage is null or jsonb_typeof(p_usage)<>'object' then raise exception 'Invalid assessment' using errcode='22023'; end if;
 select * into a from public.whatsapp_assets where id=p_asset_id and client_id=p_client_id for update;
 if not found or a.imported_at is null or a.purged_at is not null or a.media_kind<>'image' then raise exception 'Asset not assessable' using errcode='55000'; end if;
 verdict:=p_assessment->>'verdict';confidential:=(p_assessment->>'confidential')::boolean;cost:=(p_usage->>'estimated_cost_eur')::numeric;
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,analyzed_at)
 values(a.id,a.client_id,verdict,(p_assessment->>'business_relevance')::numeric,(p_assessment->>'publishability')::numeric,
  coalesce((select array_agg(x) from jsonb_array_elements_text(p_assessment->'sensitive') x),'{}'),confidential,p_assessment->>'description',
  coalesce((select array_agg(left(x,80)) from jsonb_array_elements_text(p_assessment->'topics') x),'{}'),p_assessment->>'quality',
  coalesce((select array_agg(x) from jsonb_array_elements_text(p_assessment->'quality_issues') x),'{}'),(p_assessment->>'profile_version')::integer,p_usage->>'model',cost,now())
 on conflict(asset_id) do update set verdict=excluded.verdict,business_relevance=excluded.business_relevance,publishability=excluded.publishability,sensitive=excluded.sensitive,
  confidential=excluded.confidential,description=excluded.description,topics=excluded.topics,quality=excluded.quality,quality_issues=excluded.quality_issues,
  profile_version=excluded.profile_version,model=excluded.model,estimated_cost_eur=excluded.estimated_cost_eur,analyzed_at=excluded.analyzed_at;
 insert into public.client_media_ai_usage(client_id,asset_id,purpose,model,input_tokens,output_tokens,estimated_cost_eur)
 values(a.client_id,a.id,'classification',p_usage->>'model',(p_usage->>'input_tokens')::integer,(p_usage->>'output_tokens')::integer,cost);
 next_status:=a.library_status;
 if a.library_status in ('received','to_review') and (a.status_changed_by is null or a.status_changed_by !~ '^user_') then
  next_status:=case when confidential or verdict='off_topic' then 'quarantined' else 'to_review' end;
  if next_status<>a.library_status then
   update public.whatsapp_assets set library_status=next_status,status_changed_at=now(),status_changed_by='ai_classification' where id=a.id;
  end if;
 end if;
 return next_status;
end $$;

-- Décision humaine sur des médias (reclassement, sortie de quarantaine, rejet définitif) : l'évaluation garde la trace.
create function public.whatsapp_assets_review(p_client_id uuid,p_asset_ids uuid[],p_status text,p_actor_id text)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare n integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_status not in ('received','to_review','validated','archived','quarantined','rejected')
  or p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 120 then raise exception 'Invalid review' using errcode='22023'; end if;
 update public.whatsapp_assets set library_status=p_status,status_changed_at=now(),status_changed_by=p_actor_id
 where client_id=p_client_id and id=any(p_asset_ids) and imported_at is not null and purged_at is null;
 get diagnostics n=row_count;
 update public.whatsapp_asset_assessments set manual_verdict=case p_status when 'validated' then 'relevant' when 'rejected' then 'off_topic' when 'quarantined' then 'off_topic' else manual_verdict end,
  reviewed_by=p_actor_id,reviewed_at=now()
 where client_id=p_client_id and asset_id=any(p_asset_ids);
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.status','admin',p_actor_id,'client',p_client_id,jsonb_build_object('status',p_status,'count',n));
 return n;
end $$;

-- Purge : uniquement des médias rejetés par un humain, après la conservation du client, si sa politique le demande.
create function public.whatsapp_rejected_purge_candidates(p_limit integer) returns table(asset_id uuid,client_id uuid,drive_file_id text,drive_folder_id text,origin text,thumbnail_path text)
language sql stable security invoker set search_path=pg_catalog as $$
 select a.id,a.client_id,a.drive_file_id,a.drive_folder_id,a.origin,a.thumbnail_path from public.whatsapp_assets a
 join public.client_media_profiles p on p.client_id=a.client_id
 where a.library_status='rejected' and a.purged_at is null and a.status_changed_by ~ '^user_' and p.rejected_deletion_policy='trash_drive'
   and a.status_changed_at < now() - make_interval(days => p.quarantine_retention_days)
 order by a.status_changed_at limit least(greatest(coalesce(p_limit,0),0),50);
$$;
create function public.whatsapp_asset_mark_purged(p_asset_id uuid,p_client_id uuid,p_drive_trashed boolean) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 update public.whatsapp_assets set purged_at=now(),thumbnail_path=null,caption=null,sender=null
 where id=p_asset_id and client_id=p_client_id and library_status='rejected' and purged_at is null;
 if not found then return false; end if;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.purged','system',null,'client',p_client_id,jsonb_build_object('asset_id',p_asset_id,'drive_trashed',coalesce(p_drive_trashed,false)));
 return true;
end $$;

-- 4. Droits : service_role uniquement, RLS sans politique.
alter table public.client_media_profiles enable row level security;
alter table public.whatsapp_asset_assessments enable row level security;
alter table public.client_media_ai_usage enable row level security;
revoke all on public.client_media_profiles, public.whatsapp_asset_assessments, public.client_media_ai_usage from public, anon, authenticated, service_role;
grant select, insert, update on public.client_media_profiles, public.whatsapp_asset_assessments to service_role;
grant select, insert on public.client_media_ai_usage to service_role;
revoke all on function codev_private.media_profile_list_valid(text[]), public.client_media_profile_save(uuid,jsonb,text), public.client_media_ai_month_spend(uuid),
  public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb), public.whatsapp_assets_review(uuid,uuid[],text,text),
  public.whatsapp_rejected_purge_candidates(integer), public.whatsapp_asset_mark_purged(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function codev_private.media_profile_list_valid(text[]), public.client_media_profile_save(uuid,jsonb,text), public.client_media_ai_month_spend(uuid),
  public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb), public.whatsapp_assets_review(uuid,uuid[],text,text),
  public.whatsapp_rejected_purge_candidates(integer), public.whatsapp_asset_mark_purged(uuid,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
