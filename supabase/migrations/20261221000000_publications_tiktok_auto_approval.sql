-- Validation automatique étendue à TikTok. Une publication TikTok approuvée sans réglages TikTok choisis par un humain
-- n'est jamais publiée directement : la diffusion l'envoie dans l'application TikTok du compte (mode « Upload »), où le
-- créateur choisit lui-même la confidentialité et publie (exigence TikTok respectée). Les autres garde-fous ne changent
-- pas : validation automatique activée par le client, révision de l'agent, créneau dans la fenêtre, canal actif, photo.
create or replace function publications_private.auto_approval_eligible(p_publication_id uuid, p_now timestamptz)
returns boolean language sql stable set search_path to 'pg_catalog' as $$
 select exists(
  select 1 from public.publications p
  join public.publication_client_settings s on s.client_id=p.client_id and s.auto_approve_enabled
  join public.publication_channel_occurrences o on o.id=p.occurrence_id and o.publication_id=p.id and o.skipped_at is null
  join public.publication_revisions r on r.id=p.current_revision_id and r.publication_id=p.id
  join public.publication_project_channels c on c.project_id=p.project_id and c.platform=p.platform and c.enabled
  where p.id=p_publication_id and p.status='pending_review' and p.archived_at is null
   and p.platform is not null and r.origin='generated'
   and o.scheduled_for>p_now and o.scheduled_for<=p_now+make_interval(hours=>s.auto_approve_hours_before));
$$;
revoke all on function publications_private.auto_approval_eligible(uuid,timestamptz) from public, anon, authenticated;
grant execute on function publications_private.auto_approval_eligible(uuid,timestamptz) to service_role;
