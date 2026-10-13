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
