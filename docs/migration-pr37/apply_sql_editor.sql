-- =========================================================================================================
-- PR #37 : application manuelle de supabase/migrations/20261028000000_media_library_intelligence.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261028000000_media_library_intelligence.sql (md5 5cb30e1a24d0023a5d6669ddcc3c29ae, 24206 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['publications_client_setup','whatsapp_media_library']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='media_library_intelligence' or name ~ '^[0-9]{14}_media_library_intelligence$')) then
  raise exception 'ARRET : la migration 20261028000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('codev_private.media_profile_list_valid(text[])') is not null
  or to_regprocedure('public.client_media_ai_month_spend(uuid)') is not null
  or to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)') is not null
  or to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)') is not null
  or to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)') is not null
  or to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)') is not null
  or to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)') is not null
  or to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)') is not null
  or to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)') is not null
  or to_regclass('public.client_media_ai_usage') is not null
  or to_regclass('public.client_media_profiles') is not null
  or to_regclass('public.whatsapp_asset_assessments') is not null
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='captured_at' and not attisdropped)
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='classification_failed_at' and not attisdropped)
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='classification_failures' and not attisdropped)
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='origin' and not attisdropped)
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='purged_at' and not attisdropped)
  or to_regclass('public.client_media_ai_usage_month') is not null
  or to_regclass('public.whatsapp_asset_assessments_client') is not null
  or to_regclass('public.whatsapp_assets_rejected') is not null then
  raise exception 'ARRET : des objets de la migration 20261028000000 existent déjà, ne pas la rejouer'; end if;


end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_whatsapp_assets on commit drop as select * from public.whatsapp_assets;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
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
  updated_at timestamptz not null default now(),
  -- Rotation équitable du classement planifié : dernier passage du planificateur pour ce client (jamais = prioritaire).
  last_classified_at timestamptz
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
  -- Échecs de classement IA (téléchargement, réponse invalide, enregistrement) : au-delà de 3, ou dans les heures
  -- qui suivent un échec, la photo sort de la sélection automatique (pas de nouvel appel payant en boucle).
  add column classification_failures smallint not null default 0 check (classification_failures between 0 and 100),
  add column classification_failed_at timestamptz,
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
  profile_version=excluded.profile_version,model=excluded.model,estimated_cost_eur=excluded.estimated_cost_eur,analyzed_at=excluded.analyzed_at,
  -- Une nouvelle évaluation confidentielle efface une décision humaine antérieure : elle ne peut plus la rendre publiable.
  manual_verdict=case when excluded.confidential then null else whatsapp_asset_assessments.manual_verdict end,
  reviewed_by=case when excluded.confidential then null else whatsapp_asset_assessments.reviewed_by end,
  reviewed_at=case when excluded.confidential then null else whatsapp_asset_assessments.reviewed_at end;
 update public.whatsapp_assets set classification_failures=0,classification_failed_at=null where id=a.id and classification_failures<>0;
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

-- Échec d'un classement : le coût déjà engagé auprès du fournisseur est journalisé (budget mensuel respecté),
-- le compteur d'échecs de la photo augmente. Retourne le nombre d'échecs cumulés.
create function public.whatsapp_asset_assessment_failed(p_asset_id uuid,p_client_id uuid,p_usage jsonb)
returns smallint language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.whatsapp_assets;failures smallint;
begin
 if p_usage is not null and (jsonb_typeof(p_usage)<>'object' or jsonb_typeof(p_usage->'model') is distinct from 'string' or jsonb_typeof(p_usage->'input_tokens') is distinct from 'number'
  or jsonb_typeof(p_usage->'output_tokens') is distinct from 'number' or jsonb_typeof(p_usage->'estimated_cost_eur') is distinct from 'number') then raise exception 'Invalid usage' using errcode='22023'; end if;
 select * into a from public.whatsapp_assets where id=p_asset_id and client_id=p_client_id for update;
 if not found then raise exception 'Asset not assessable' using errcode='55000'; end if;
 if p_usage is not null then
  insert into public.client_media_ai_usage(client_id,asset_id,purpose,model,input_tokens,output_tokens,estimated_cost_eur)
  values(a.client_id,a.id,'classification',left(p_usage->>'model',100),(p_usage->>'input_tokens')::integer,(p_usage->>'output_tokens')::integer,(p_usage->>'estimated_cost_eur')::numeric);
 end if;
 update public.whatsapp_assets set classification_failures=least(classification_failures+1,100),classification_failed_at=now() where id=a.id
 returning classification_failures into failures;
 return failures;
end $$;

-- Décision humaine sur des médias (reclassement, sortie de quarantaine, rejet définitif) : l'évaluation garde la trace.
-- Quarantaine ou rejet : les diffusions pas encore envoyées (programmées, en reprise, bloquées) des publications qui
-- utilisent ces médias sont annulées par publication_delivery_cancel ; les diffusions publiées ou en cours sont intactes.
create function public.whatsapp_assets_review(p_client_id uuid,p_asset_ids uuid[],p_status text,p_actor_id text)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare n integer;changed uuid[];d record;cancelled integer:=0;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_status not in ('received','to_review','validated','archived','quarantined','rejected')
  or p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 120 then raise exception 'Invalid review' using errcode='22023'; end if;
 with u as (update public.whatsapp_assets set library_status=p_status,status_changed_at=now(),status_changed_by=p_actor_id
  where client_id=p_client_id and id=any(p_asset_ids) and imported_at is not null and purged_at is null returning id)
 select coalesce(array_agg(id),'{}') into changed from u;
 n:=cardinality(changed);
 if p_status in ('quarantined','rejected') and n>0 then
  for d in select distinct pd.id,pd.publication_id from public.whatsapp_asset_uses u
   join public.publication_deliveries pd on pd.publication_id=u.publication_id and pd.client_id=u.client_id
   where u.client_id=p_client_id and u.asset_id=any(changed) and pd.revision_id is not null and pd.status in ('scheduled','retryable_error','blocked')
   order by pd.id loop
   perform public.publication_delivery_cancel(d.id,p_actor_id);
   insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.delivery_cancelled_media_withdrawn',p_client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'library_status',p_status));
   cancelled:=cancelled+1;
  end loop;
 end if;
 update public.whatsapp_asset_assessments set manual_verdict=case p_status when 'validated' then 'relevant' when 'rejected' then 'off_topic' when 'quarantined' then 'off_topic' else manual_verdict end,
  reviewed_by=p_actor_id,reviewed_at=now()
 where client_id=p_client_id and asset_id=any(p_asset_ids);
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.status','admin',p_actor_id,'client',p_client_id,jsonb_build_object('status',p_status,'count',n,'cancelled_deliveries',cancelled));
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
-- Marquage AVANT toute mise à la corbeille : faux si le média n'est plus rejeté (un humain l'a repêché entre-temps),
-- auquel cas rien n'est mis à la corbeille. p_drive_trash_planned : une mise à la corbeille Drive va être tentée.
create function public.whatsapp_asset_mark_purged(p_asset_id uuid,p_client_id uuid,p_drive_trash_planned boolean) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 update public.whatsapp_assets set purged_at=now(),thumbnail_path=null,caption=null,sender=null
 where id=p_asset_id and client_id=p_client_id and library_status='rejected' and status_changed_by ~ '^user_' and purged_at is null;
 if not found then return false; end if;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.purged','system',null,'client',p_client_id,jsonb_build_object('asset_id',p_asset_id,'drive_trash_planned',coalesce(p_drive_trash_planned,false)));
 return true;
end $$;
-- Résultat de la mise à la corbeille Drive d'un média déjà marqué purgé (journal uniquement).
create function public.whatsapp_asset_purge_trash_logged(p_asset_id uuid,p_client_id uuid,p_outcome text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_outcome is null or p_outcome not in ('trashed','missing','failed') then raise exception 'Invalid outcome' using errcode='22023'; end if;
 if not exists(select 1 from public.whatsapp_assets where id=p_asset_id and client_id=p_client_id and purged_at is not null) then
  raise exception 'Asset not purged' using errcode='55000'; end if;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.purge_trash','system',null,'client',p_client_id,jsonb_build_object('asset_id',p_asset_id,'outcome',p_outcome));
end $$;

-- 4. Droits : service_role uniquement, RLS sans politique.
alter table public.client_media_profiles enable row level security;
alter table public.whatsapp_asset_assessments enable row level security;
alter table public.client_media_ai_usage enable row level security;
revoke all on public.client_media_profiles, public.whatsapp_asset_assessments, public.client_media_ai_usage from public, anon, authenticated, service_role;
grant select, insert, update on public.client_media_profiles, public.whatsapp_asset_assessments to service_role;
grant select, insert on public.client_media_ai_usage to service_role;
revoke all on function codev_private.media_profile_list_valid(text[]), public.client_media_profile_save(uuid,jsonb,text), public.client_media_ai_month_spend(uuid),
  public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb), public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb), public.whatsapp_assets_review(uuid,uuid[],text,text),
  public.whatsapp_rejected_purge_candidates(integer), public.whatsapp_asset_mark_purged(uuid,uuid,boolean), public.whatsapp_asset_purge_trash_logged(uuid,uuid,text) from public, anon, authenticated;
grant execute on function codev_private.media_profile_list_valid(text[]), public.client_media_profile_save(uuid,jsonb,text), public.client_media_ai_month_spend(uuid),
  public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb), public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb), public.whatsapp_assets_review(uuid,uuid[],text,text),
  public.whatsapp_rejected_purge_candidates(integer), public.whatsapp_asset_mark_purged(uuid,uuid,boolean), public.whatsapp_asset_purge_trash_logged(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('codev_private.media_profile_list_valid(text[])'))='716ac55756fd8f0f6028e7a9096b1ecb',false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_profile_list_valid(text[]) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('codev_private.media_profile_list_valid(text[])')),false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_profile_list_valid(text[]) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('codev_private.media_profile_list_valid(text[])'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('codev_private.media_profile_list_valid(text[])'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('codev_private.media_profile_list_valid(text[])'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('codev_private.media_profile_list_valid(text[])'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_profile_list_valid(text[]) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.client_media_ai_month_spend(uuid)'))='0663e700b29a201656c7de2f808f3844',false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_ai_month_spend(uuid) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.client_media_ai_month_spend(uuid)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_ai_month_spend(uuid) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.client_media_ai_month_spend(uuid)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.client_media_ai_month_spend(uuid)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.client_media_ai_month_spend(uuid)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.client_media_ai_month_spend(uuid)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_ai_month_spend(uuid) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)'))='e1da4ab94791cabd30c585ad2fa067de',false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_profile_save(uuid,jsonb,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_profile_save(uuid,jsonb,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.client_media_profile_save(uuid,jsonb,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.client_media_profile_save(uuid,jsonb,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)'))='2f2df7e81dc62c5dcd4f426a55b73197',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_failed(uuid,uuid,jsonb) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)'))='b5f63f1ae697b5b24465be236cb52cd8',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_assessment_record(uuid,uuid,jsonb,jsonb) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)'))='c6d6b1a351bf0dd400781ccf885a71e0',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_mark_purged(uuid,uuid,boolean) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_mark_purged(uuid,uuid,boolean) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_mark_purged(uuid,uuid,boolean)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_mark_purged(uuid,uuid,boolean) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)'))='da136fb4b288d641135a5e85d8b73163',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_purge_trash_logged(uuid,uuid,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_purge_trash_logged(uuid,uuid,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_purge_trash_logged(uuid,uuid,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_purge_trash_logged(uuid,uuid,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)'))='70b1549b484ac3853a334365bb58d4cb',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_assets_review(uuid,uuid[],text,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_assets_review(uuid,uuid[],text,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_assets_review(uuid,uuid[],text,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_assets_review(uuid,uuid[],text,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)'))='35c2b2cd82997c807eda776b5ef6f159',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_rejected_purge_candidates(integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_rejected_purge_candidates(integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_rejected_purge_candidates(integer)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_rejected_purge_candidates(integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.client_media_ai_usage')),false)=true) then raise exception 'VERIFICATION : %', 'table public.client_media_ai_usage : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.client_media_ai_usage'),'SELECT') or has_table_privilege('anon',to_regclass('public.client_media_ai_usage'),'INSERT') or has_table_privilege('anon',to_regclass('public.client_media_ai_usage'),'UPDATE') or has_table_privilege('anon',to_regclass('public.client_media_ai_usage'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.client_media_ai_usage'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.client_media_ai_usage'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.client_media_ai_usage'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.client_media_ai_usage'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.client_media_ai_usage'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.client_media_ai_usage'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.client_media_ai_usage'),'UPDATE')=false and has_table_privilege('service_role',to_regclass('public.client_media_ai_usage'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.client_media_ai_usage : aucun droit pour anon et authenticated, service_role SELECT,INSERT'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.client_media_profiles')),false)=true) then raise exception 'VERIFICATION : %', 'table public.client_media_profiles : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.client_media_profiles'),'SELECT') or has_table_privilege('anon',to_regclass('public.client_media_profiles'),'INSERT') or has_table_privilege('anon',to_regclass('public.client_media_profiles'),'UPDATE') or has_table_privilege('anon',to_regclass('public.client_media_profiles'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.client_media_profiles'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.client_media_profiles'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.client_media_profiles'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.client_media_profiles'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.client_media_profiles'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.client_media_profiles'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.client_media_profiles'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.client_media_profiles'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.client_media_profiles : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_asset_assessments')),false)=true) then raise exception 'VERIFICATION : %', 'table public.whatsapp_asset_assessments : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_asset_assessments'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_assessments'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_assessments'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_assessments'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_assessments'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_assessments'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_assessments'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_assessments'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_assessments'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_assessments'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_assessments'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_assessments'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.whatsapp_asset_assessments : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='captured_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.captured_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='classification_failed_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.classification_failed_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='classification_failures' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='smallint' and a.attnotnull=true and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='0')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.classification_failures : smallint not null default 0'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='origin' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='text' and a.attnotnull=true and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='''whatsapp''::text')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.origin : text not null default ''whatsapp''::text'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='purged_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.purged_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.client_media_ai_usage_month') and indrelid=to_regclass('public.client_media_ai_usage') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.client_media_ai_usage_month sur public.client_media_ai_usage : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_asset_assessments_client') and indrelid=to_regclass('public.whatsapp_asset_assessments') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_asset_assessments_client sur public.whatsapp_asset_assessments : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_assets_rejected') and indrelid=to_regclass('public.whatsapp_assets') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_assets_rejected sur public.whatsapp_assets : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.client_media_profiles') and conname='client_media_profiles_lists' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte client_media_profiles_lists sur public.client_media_profiles : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.whatsapp_assets') and conname='whatsapp_assets_rejected_by_human' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte whatsapp_assets_rejected_by_human sur public.whatsapp_assets : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.whatsapp_assets') and conname='whatsapp_assets_library_status_check' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte whatsapp_assets_library_status_check sur public.whatsapp_assets : présente et validée'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.whatsapp_assets','_kit_snap_public_whatsapp_assets',''),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
  select string_agg(format('%I', attname), ',' order by attnum) into cols from pg_attribute
   where attrelid=('pg_temp.'||t.snap)::regclass and attnum>0 and not attisdropped and attname<>all(string_to_array(t.excluded, ','));
  execute format('select count(*) from ((select row(%s)::text from pg_temp.%I) except all (select row(%s)::text from %s)) d', cols, t.snap, cols, t.rel) into n;
  if n<>0 then raise exception 'VERIFICATION : % ligne(s) de % modifiée(s)', n, t.rel; end if;
  execute format('select (select count(*) from %s)-(select count(*) from pg_temp.%I)', t.rel, t.snap) into n;
  if n<>0 then raise exception 'VERIFICATION : le nombre de lignes de % a changé', t.rel; end if;
 end loop;
 if (select auto_prepare from _kit_flags)<>(select count(*) from public.publication_client_settings where auto_prepare_enabled)
  or (select emergency_stop from _kit_flags)<>(select count(*) from public.publication_settings where emergency_stop) then
  raise exception 'VERIFICATION : un interrupteur de publication a changé'; end if;

 raise notice 'Migration 20261028000000 appliquée et vérifiée (% contrôles).', 44;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261028000000 appliquée' as migration, 44 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
