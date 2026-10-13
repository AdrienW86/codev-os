-- =========================================================================================================
-- PR #43 : application manuelle de supabase/migrations/20261103000000_media_library_tools.sql
-- À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.
-- Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).
-- La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :
-- exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.
-- Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié
-- (vérifié à la fin par comparaison avec une photographie prise au début).
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261103000000_media_library_tools.sql (md5 93b8a2033773f0fb807801c06c48d375, 16589 octets).
-- =========================================================================================================
begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array['whatsapp_export_import']::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where (name='media_library_tools' or name ~ '^[0-9]{14}_media_library_tools$')) then
  raise exception 'ARRET : la migration 20261103000000 est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if to_regprocedure('codev_private.media_fold(text)') is not null
  or to_regprocedure('codev_private.whatsapp_asset_decision_log()') is not null
  or to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)') is not null
  or to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)') is not null
  or to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])') is not null
  or to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)') is not null
  or to_regclass('public.client_media_drive_files') is not null
  or to_regclass('public.client_media_drive_sync') is not null
  or to_regclass('public.whatsapp_asset_decisions') is not null
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='caption_edited_at' and not attisdropped)
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.whatsapp_assets') and attname='caption_edited_by' and not attisdropped)
  or to_regclass('public.whatsapp_asset_decisions_asset') is not null
  or to_regclass('public.whatsapp_assets_client_sha') is not null
  or exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_assets') and tgname='whatsapp_asset_decision_log') then
  raise exception 'ARRET : des objets de la migration 20261103000000 existent déjà, ne pas la rejouer'; end if;


end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
create temporary table _kit_snap_public_whatsapp_assets on commit drop as select * from public.whatsapp_assets;
create temporary table _kit_snap_public_whatsapp_asset_assessments on commit drop as select * from public.whatsapp_asset_assessments;
create temporary table _kit_snap_public_audit_logs on commit drop as select * from public.audit_logs;
create temporary table _kit_snap_public_publication_settings on commit drop as select * from public.publication_settings;
create temporary table _kit_snap_public_publication_client_settings on commit drop as select * from public.publication_client_settings;
create temporary table _kit_snap_public_clients on commit drop as select * from public.clients;
create temporary table _kit_snap_public_publications on commit drop as select * from public.publications;
create temporary table _kit_snap_public_publication_deliveries on commit drop as select * from public.publication_deliveries;
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
-- Photothèque, outils de travail (suite des lots 2 et 3) : recherche filtrée et paginée côté serveur, historique
-- d'utilisation réutilisable, décisions humaines tracées (« Pourquoi écartée ? », reclassement manuel), édition de la
-- légende, mémoire de la synchronisation Drive (doublons et échecs non retéléchargés, reprise des dossiers volumineux).
-- Dépend de 20261101000000_whatsapp_export_import.sql (ordre de fusion) et des règles de la sélection éditoriale
-- (20261029000000) qu'elle lit sans les modifier. Forward-only, additive : aucune ligne existante modifiée, aucune
-- fonction existante remplacée, rien n'est activé. Aucun fichier n'est jamais supprimé par la base.

-- 1. Légende éditée par un administrateur (le texte remplace la légende ; seul le fait de l'édition est tracé).
alter table public.whatsapp_assets
  add column caption_edited_by text check (caption_edited_by is null or caption_edited_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  add column caption_edited_at timestamptz,
  add constraint whatsapp_assets_caption_edit_pair check ((caption_edited_by is null) = (caption_edited_at is null));
-- Dédoublonnage par empreinte à l'échelle du client (tous dossiers et toutes origines confondus).
create index whatsapp_assets_client_sha on public.whatsapp_assets (client_id, sha256);

-- 2. Historique des décisions humaines (ajout seul) : statut posé par une personne (motif facultatif, obligatoire pour
--    un reclassement), légende éditée. Jamais de texte de légende ni de numéro dans cette table.
create table public.whatsapp_asset_decisions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  kind text not null check (kind in ('status','reclassify','caption')),
  from_status text check (from_status is null or from_status in ('received','to_review','validated','used','archived','quarantined','rejected')),
  to_status text check (to_status is null or to_status in ('received','to_review','validated','used','archived','quarantined','rejected')),
  reason text check (reason is null or (length(btrim(reason)) between 3 and 500 and reason !~ '[\x00-\x09\x0b-\x1f]')),
  actor_id text not null check (actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  created_at timestamptz not null default now(),
  check (kind<>'reclassify' or reason is not null),
  foreign key (asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete restrict
);
create index whatsapp_asset_decisions_asset on public.whatsapp_asset_decisions (client_id, asset_id, created_at desc);

-- Tout changement de statut posé par une personne (whatsapp_assets_review, préparation de publication, agent) est
-- historisé. Le motif et la nature « reclassement » ne viennent que de whatsapp_asset_reclassify (réglage local).
create function codev_private.whatsapp_asset_decision_log() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare reason text := nullif(current_setting('codev.media_decision_reason', true), '');
begin
  if new.library_status is distinct from old.library_status and new.status_changed_by ~ '^user_[a-zA-Z0-9_-]{1,200}$' then
    insert into public.whatsapp_asset_decisions(asset_id, client_id, kind, from_status, to_status, reason, actor_id)
    values (new.id, new.client_id, case when reason is null then 'status' else 'reclassify' end, old.library_status, new.library_status, reason, new.status_changed_by);
  end if;
  return new;
end $$;
create trigger whatsapp_asset_decision_log after update of library_status on public.whatsapp_assets
  for each row execute function codev_private.whatsapp_asset_decision_log();

-- 3. Reclassement manuel d'une photo (administrateur, motif obligatoire) : réutilise whatsapp_assets_review (verdict
--    manuel, annulation des diffusions non envoyées en cas de quarantaine ou de rejet, audit), puis trace le motif.
--    Le statut posé par une personne n'est jamais modifié par une évaluation automatique ultérieure
--    (whatsapp_asset_assessment_record ne touche qu'aux statuts posés par le système).
create function public.whatsapp_asset_reclassify(p_client_id uuid, p_asset_id uuid, p_status text, p_reason text, p_actor_id text) returns jsonb
language plpgsql security invoker set search_path = pg_catalog as $$
declare a public.whatsapp_assets; n integer; clean text := btrim(coalesce(p_reason, ''));
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_status is null
    or p_status not in ('received','to_review','validated','archived','quarantined','rejected')
    or length(clean) not between 3 and 500 or clean ~ '[\x00-\x09\x0b-\x1f]' then
    raise exception 'Invalid reclassification' using errcode = '22023';
  end if;
  select * into a from public.whatsapp_assets where id = p_asset_id and client_id = p_client_id for update;
  if not found or a.imported_at is null or a.purged_at is not null then raise exception 'Asset not reviewable' using errcode = '55000'; end if;
  -- Même statut déjà posé par une personne : rien à reclasser. Un statut posé par l'analyse peut être confirmé.
  if a.library_status = p_status and a.status_changed_by ~ '^user_' then raise exception 'Status unchanged' using errcode = '55000'; end if;
  perform set_config('codev.media_decision_reason', clean, true);
  n := public.whatsapp_assets_review(p_client_id, array[p_asset_id], p_status, p_actor_id);
  perform set_config('codev.media_decision_reason', '', true);
  if n <> 1 then raise exception 'Asset not reviewable' using errcode = '55000'; end if;
  -- Confirmation d'un statut automatique : le statut ne change pas, le déclencheur n'écrit rien ; la décision est tracée ici.
  if a.library_status = p_status then
    insert into public.whatsapp_asset_decisions(asset_id, client_id, kind, from_status, to_status, reason, actor_id)
    values (p_asset_id, p_client_id, 'reclassify', a.library_status, p_status, clean, p_actor_id);
  end if;
  insert into public.audit_logs(action, actor_type, actor_id, resource_type, resource_id, metadata)
  values ('whatsapp.library.reclassified', 'admin', p_actor_id, 'client', p_client_id,
    jsonb_build_object('asset_id', p_asset_id, 'from_status', a.library_status, 'to_status', p_status, 'reason_length', length(clean)));
  return jsonb_build_object('asset_id', p_asset_id, 'from_status', a.library_status, 'to_status', p_status);
end $$;

-- 4. Légende d'une photo, éditée par un administrateur (vide = effacée). Le texte reste une donnée, jamais une consigne.
create function public.whatsapp_asset_caption_save(p_client_id uuid, p_asset_id uuid, p_caption text, p_actor_id text) returns boolean
language plpgsql security invoker set search_path = pg_catalog as $$
declare clean text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or length(coalesce(clean, '')) > 3000
    or coalesce(clean, '') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'Invalid caption' using errcode = '22023';
  end if;
  update public.whatsapp_assets set caption = clean, caption_edited_by = p_actor_id, caption_edited_at = now()
  where id = p_asset_id and client_id = p_client_id and imported_at is not null and purged_at is null;
  if not found then return false; end if;
  insert into public.whatsapp_asset_decisions(asset_id, client_id, kind, actor_id) values (p_asset_id, p_client_id, 'caption', p_actor_id);
  insert into public.audit_logs(action, actor_type, actor_id, resource_type, resource_id, metadata)
  values ('whatsapp.library.caption_edited', 'admin', p_actor_id, 'client', p_client_id,
    jsonb_build_object('asset_id', p_asset_id, 'length', length(coalesce(clean, ''))));
  return true;
end $$;

-- 5. Historique d'utilisation (modèle de lecture partagé) : publication, plateforme, date d'utilisation, état de la
--    publication et de sa diffusion sur cette plateforme. Strictement limité au client demandé.
create function public.whatsapp_asset_usage_history(p_client_id uuid, p_asset_ids uuid[])
returns table(asset_id uuid, publication_id uuid, platform text, used_at timestamptz, used_by text, subject text,
  publication_status text, archived boolean, delivery_status text, scheduled_for timestamptz, published_at timestamptz)
language sql stable security invoker set search_path = pg_catalog as $$
  select u.asset_id, u.publication_id, u.platform, u.used_at, u.used_by, p.subject, p.status, p.archived_at is not null,
    d.status, d.scheduled_for, d.published_at
  from public.whatsapp_asset_uses u
  join public.publications p on p.id = u.publication_id and p.client_id = u.client_id
  left join lateral (select pd.status, pd.scheduled_for, pd.published_at from public.publication_deliveries pd
    where pd.publication_id = u.publication_id and pd.client_id = u.client_id and pd.platform = u.platform
    order by pd.created_at desc limit 1) d on true
  where u.client_id = p_client_id and u.asset_id = any(coalesce(p_asset_ids, '{}'::uuid[]))
    and cardinality(coalesce(p_asset_ids, '{}'::uuid[])) <= 200
  order by u.used_at desc, u.id;
$$;

-- 6. Recherche dans la photothèque du client, filtrée et paginée côté serveur. Vues de statut : active (par défaut :
--    ni archivées, ni quarantaine, ni rejetées), to_review, publishable (règle serveur de la sélection éditoriale),
--    validated, used (déjà utilisée), quarantined, rejected, archived, all. Origine, service/sujet (thèmes et
--    description de l'évaluation, légende), texte libre (y compris le sujet des publications), période d'origine
--    (prise de vue, sinon réception, sinon import ; jours de Paris), déjà utilisée oui/non. Les photos purgées n'apparaissent jamais.
create function codev_private.media_fold(p_text text) returns text
language sql immutable security invoker set search_path = pg_catalog as $$
  select lower(translate(coalesce(p_text, ''), 'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'));
$$;
create function public.whatsapp_library_search(p_client_id uuid, p_filters jsonb, p_limit integer, p_offset integer)
returns table(asset_id uuid, total bigint)
language plpgsql stable security invoker set search_path = pg_catalog as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_status text; v_origin text; v_service text; v_q text; v_used text; v_from date; v_to date;
begin
  if jsonb_typeof(f) <> 'object' or exists(select 1 from jsonb_object_keys(f) k where k not in ('status','origin','service','q','used','from','to')) then
    raise exception 'Invalid filters' using errcode = '22023';
  end if;
  v_status := coalesce(f->>'status', 'active'); v_origin := f->>'origin'; v_used := f->>'used';
  v_service := nullif(codev_private.media_fold(btrim(left(f->>'service', 120))), '');
  v_q := nullif(codev_private.media_fold(btrim(left(f->>'q', 120))), '');
  if v_status not in ('active','to_review','publishable','validated','used','quarantined','rejected','archived','all')
    or (v_origin is not null and v_origin not in ('whatsapp','whatsapp_export','drive')) or (v_used is not null and v_used not in ('yes','no'))
    or (f ? 'from' and coalesce(f->>'from', '') !~ '^\d{4}-\d{2}-\d{2}$') or (f ? 'to' and coalesce(f->>'to', '') !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'Invalid filters' using errcode = '22023';
  end if;
  v_from := (f->>'from')::date; v_to := (f->>'to')::date;
  return query
  select a.id, count(*) over ()
  from public.whatsapp_assets a
  left join public.whatsapp_asset_assessments s on s.asset_id = a.id and s.client_id = a.client_id
  where a.client_id = p_client_id and a.imported_at is not null and a.purged_at is null
    and case v_status
      when 'active' then a.library_status not in ('archived','quarantined','rejected')
      when 'to_review' then a.library_status in ('received','to_review')
      when 'publishable' then publications_private.library_asset_publishable(a)
      when 'used' then a.library_status = 'used' or exists(select 1 from public.whatsapp_asset_uses u where u.asset_id = a.id and u.client_id = a.client_id)
      when 'all' then true
      else a.library_status = v_status end
    and (v_origin is null or a.origin = v_origin)
    and (v_used is null or (v_used = 'yes') = exists(select 1 from public.whatsapp_asset_uses u where u.asset_id = a.id and u.client_id = a.client_id))
    and (v_from is null or coalesce(a.captured_at, a.received_at, a.imported_at) >= v_from::timestamp at time zone 'Europe/Paris')
    and (v_to is null or coalesce(a.captured_at, a.received_at, a.imported_at) < (v_to + 1)::timestamp at time zone 'Europe/Paris')
    and (v_service is null or position(v_service in codev_private.media_fold(coalesce(array_to_string(s.topics, ' '), '') || ' ' || coalesce(s.description, '') || ' ' || coalesce(a.caption, ''))) > 0)
    and (v_q is null or position(v_q in codev_private.media_fold(coalesce(array_to_string(s.topics, ' '), '') || ' ' || coalesce(s.description, '') || ' ' || coalesce(a.caption, ''))) > 0
      or exists(select 1 from public.whatsapp_asset_uses u join public.publications p on p.id = u.publication_id and p.client_id = u.client_id
        where u.asset_id = a.id and u.client_id = a.client_id and position(v_q in codev_private.media_fold(p.subject)) > 0))
  order by coalesce(a.captured_at, a.received_at, a.imported_at) desc, a.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60) offset least(greatest(coalesce(p_offset, 0), 0), 10000);
end $$;

-- 7. Synchronisation des dossiers Drive : fichiers déjà examinés sans entrée propre (doublon d'une photo connue du
--    client, échec de lecture) pour ne pas les retélécharger à chaque passage, et curseur de reprise des dossiers de
--    plus de 100 photos (parcours du plus ancien au plus récent, recommencé à la fin).
create table public.client_media_drive_files (
  client_id uuid not null references public.clients(id) on delete restrict,
  drive_file_id text not null check (drive_file_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
  drive_folder_id text not null check (drive_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
  outcome text not null check (outcome in ('duplicate','failed')),
  asset_id uuid,
  failures smallint not null default 0 check (failures between 0 and 100),
  error_code text check (error_code is null or error_code ~ '^[A-Za-z_ ]{1,60}$'),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, drive_file_id),
  check (outcome <> 'duplicate' or asset_id is not null),
  foreign key (asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete restrict
);
create table public.client_media_drive_sync (
  client_id uuid not null references public.clients(id) on delete restrict,
  drive_folder_id text not null check (drive_folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
  backfill_after timestamptz,
  backfill_completed_at timestamptz,
  last_synced_at timestamptz,
  primary key (client_id, drive_folder_id)
);

-- 8. Droits : service_role uniquement, RLS sans politique ; historique des décisions en ajout seul.
alter table public.whatsapp_asset_decisions enable row level security;
alter table public.client_media_drive_files enable row level security;
alter table public.client_media_drive_sync enable row level security;
revoke all on public.whatsapp_asset_decisions, public.client_media_drive_files, public.client_media_drive_sync from public, anon, authenticated, service_role;
grant select, insert on public.whatsapp_asset_decisions to service_role;
grant select, insert, update on public.client_media_drive_files, public.client_media_drive_sync to service_role;
revoke all on function codev_private.whatsapp_asset_decision_log(), public.whatsapp_asset_reclassify(uuid,uuid,text,text,text),
  public.whatsapp_asset_caption_save(uuid,uuid,text,text), public.whatsapp_asset_usage_history(uuid,uuid[]), codev_private.media_fold(text),
  public.whatsapp_library_search(uuid,jsonb,integer,integer) from public, anon, authenticated;
grant execute on function codev_private.whatsapp_asset_decision_log(), public.whatsapp_asset_reclassify(uuid,uuid,text,text,text),
  public.whatsapp_asset_caption_save(uuid,uuid,text,text), public.whatsapp_asset_usage_history(uuid,uuid[]), codev_private.media_fold(text),
  public.whatsapp_library_search(uuid,jsonb,integer,integer) to service_role;
notify pgrst, 'reload schema';

-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('codev_private.media_fold(text)'))='0ebf38edb21dbab5dafb227dee1cf5e9',false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_fold(text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('codev_private.media_fold(text)')),false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_fold(text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('codev_private.media_fold(text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('codev_private.media_fold(text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('codev_private.media_fold(text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('codev_private.media_fold(text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.media_fold(text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('codev_private.whatsapp_asset_decision_log()'))='f3e5ae6d9f11dcb0fa7bd5a7b162cf41',false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.whatsapp_asset_decision_log() : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('codev_private.whatsapp_asset_decision_log()')),false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.whatsapp_asset_decision_log() : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('codev_private.whatsapp_asset_decision_log()'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('codev_private.whatsapp_asset_decision_log()'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('codev_private.whatsapp_asset_decision_log()'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('codev_private.whatsapp_asset_decision_log()'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction codev_private.whatsapp_asset_decision_log() : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)'))='8fbae5ec281ec18c08beaaa17aed05f5',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_caption_save(uuid,uuid,text,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_caption_save(uuid,uuid,text,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_caption_save(uuid,uuid,text,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_caption_save(uuid,uuid,text,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)'))='e52659b644cbeefd2128a59c172b52a8',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_reclassify(uuid,uuid,text,text,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_reclassify(uuid,uuid,text,text,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_reclassify(uuid,uuid,text,text,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])'))='0c87e3343ca59fef24dfd0f6a3055436',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_usage_history(uuid,uuid[]) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_usage_history(uuid,uuid[]) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_asset_usage_history(uuid,uuid[])'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_asset_usage_history(uuid,uuid[]) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)'))='1d8145f912ff8554e5f3ea5393b4a849',false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_library_search(uuid,jsonb,integer,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)')),false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_library_search(uuid,jsonb,integer,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.whatsapp_library_search(uuid,jsonb,integer,integer)'),'EXECUTE')=true,false)) then raise exception 'VERIFICATION : %', 'fonction public.whatsapp_library_search(uuid,jsonb,integer,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.client_media_drive_files')),false)=true) then raise exception 'VERIFICATION : %', 'table public.client_media_drive_files : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.client_media_drive_files'),'SELECT') or has_table_privilege('anon',to_regclass('public.client_media_drive_files'),'INSERT') or has_table_privilege('anon',to_regclass('public.client_media_drive_files'),'UPDATE') or has_table_privilege('anon',to_regclass('public.client_media_drive_files'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.client_media_drive_files'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_files'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_files'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_files'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.client_media_drive_files'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_files'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_files'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_files'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.client_media_drive_files : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.client_media_drive_sync')),false)=true) then raise exception 'VERIFICATION : %', 'table public.client_media_drive_sync : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.client_media_drive_sync'),'SELECT') or has_table_privilege('anon',to_regclass('public.client_media_drive_sync'),'INSERT') or has_table_privilege('anon',to_regclass('public.client_media_drive_sync'),'UPDATE') or has_table_privilege('anon',to_regclass('public.client_media_drive_sync'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.client_media_drive_sync'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_sync'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_sync'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.client_media_drive_sync'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.client_media_drive_sync'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_sync'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_sync'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.client_media_drive_sync'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.client_media_drive_sync : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_asset_decisions')),false)=true) then raise exception 'VERIFICATION : %', 'table public.whatsapp_asset_decisions : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_asset_decisions'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_decisions'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_decisions'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_asset_decisions'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_decisions'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_decisions'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_decisions'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_asset_decisions'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_decisions'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_decisions'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_decisions'),'UPDATE')=false and has_table_privilege('service_role',to_regclass('public.whatsapp_asset_decisions'),'DELETE')=false,false)) then raise exception 'VERIFICATION : %', 'table public.whatsapp_asset_decisions : aucun droit pour anon et authenticated, service_role SELECT,INSERT'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='caption_edited_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.caption_edited_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.whatsapp_assets') and a.attname='caption_edited_by' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='text' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'VERIFICATION : %', 'colonne public.whatsapp_assets.caption_edited_by : text'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_asset_decisions_asset') and indrelid=to_regclass('public.whatsapp_asset_decisions') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_asset_decisions_asset sur public.whatsapp_asset_decisions : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_assets_client_sha') and indrelid=to_regclass('public.whatsapp_assets') and indisvalid and indisunique=false)) then raise exception 'VERIFICATION : %', 'index public.whatsapp_assets_client_sha sur public.whatsapp_assets : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.whatsapp_assets') and conname='whatsapp_assets_caption_edit_pair' and contype='c' and convalidated)) then raise exception 'VERIFICATION : %', 'contrainte whatsapp_assets_caption_edit_pair sur public.whatsapp_assets : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_assets') and tgname='whatsapp_asset_decision_log' and tgenabled='O' and tgfoid=to_regprocedure('codev_private.whatsapp_asset_decision_log()'))) then raise exception 'VERIFICATION : %', 'déclencheur whatsapp_asset_decision_log sur public.whatsapp_assets : présent, actif, appelle codev_private.whatsapp_asset_decision_log()'; end if;
 if not (not exists(select 1 from public.whatsapp_assets where caption_edited_at is not null) and not exists(select 1 from public.whatsapp_asset_decisions) and not exists(select 1 from public.client_media_drive_files) and not exists(select 1 from public.client_media_drive_sync)) then raise exception 'VERIFICATION : %', 'photothèque : aucune ligne existante modifiée par la migration (aucune légende marquée éditée, aucune décision ni mémoire Drive)'; end if;
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ('public.whatsapp_assets','_kit_snap_public_whatsapp_assets',''),('public.whatsapp_asset_assessments','_kit_snap_public_whatsapp_asset_assessments',''),('public.audit_logs','_kit_snap_public_audit_logs',''),('public.publication_settings','_kit_snap_public_publication_settings',''),('public.publication_client_settings','_kit_snap_public_publication_client_settings',''),('public.clients','_kit_snap_public_clients',''),('public.publications','_kit_snap_public_publications',''),('public.publication_deliveries','_kit_snap_public_publication_deliveries','')) v(rel, snap, excluded) loop
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

 raise notice 'Migration 20261103000000 appliquée et vérifiée (% contrôles).', 31;
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select '20261103000000 appliquée' as migration, 31 as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
