-- Photos où l'équipe du client est visible : publiables automatiquement (accord des clients, 02/11/2026).
-- Avant, tout visage détecté imposait une validation humaine photo par photo. Désormais une photo « à examiner »
-- pour le SEUL motif d'un visage d'adulte (pertinence >= 0,6, publiable >= 0,5, qualité correcte, ni capture d'écran
-- ni image surtout textuelle, aucune autre donnée sensible) est publiable. Un mineur, une donnée confidentielle ou
-- une photo jugée hors sujet par un humain ne le sont jamais. Même règle côté application :
-- lib/media-intelligence/model.ts (isPublicationCandidate / faceOnlyReview). Aucune donnée n'est modifiée.
create or replace function publications_private.library_asset_publishable(a public.whatsapp_assets)
returns boolean language sql stable set search_path to 'pg_catalog' as $$
 select coalesce(a.id is not null and a.media_kind='image' and a.purged_at is null and a.imported_at is not null
  and a.library_status in('received','to_review','validated','used')
  and not exists(select 1 from public.whatsapp_asset_assessments s where s.asset_id=a.id and s.client_id=a.client_id and (s.confidential or s.manual_verdict='off_topic'))
  and (a.library_status in('validated','used')
   or exists(select 1 from public.whatsapp_asset_assessments s where s.asset_id=a.id and s.client_id=a.client_id
    and not ('minor'=any(s.sensitive))
    and (s.verdict='relevant'
     or (s.verdict='to_review' and s.sensitive=array['face']::text[] and s.business_relevance>=0.6 and s.publishability>=0.5
      and s.quality<>'poor' and not (s.quality_issues && array['screenshot','text_heavy']::text[]))))),false);
$$;
