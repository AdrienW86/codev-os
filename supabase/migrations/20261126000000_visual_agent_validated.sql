-- Agent Visuels : un visuel généré par l'agent (logo, couleurs et prestation du client, accroche contrôlée) entre
-- dans la photothèque déjà « validé ». Sinon l'analyse photo, faite pour des photos de chantier, le jugeait hors sujet
-- et le mettait en quarantaine (constaté le 03/11 : premier visuel France Toiture). Reconnaissance par empreinte
-- (sha256, même client), dans les deux ordres : visuel journalisé puis importé, ou importé puis journalisé.
-- Une décision humaine (status_changed_by « user_… ») n'est jamais modifiée.
create function publications_private.visual_agent_validate_asset() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_table_name='whatsapp_assets' then
  if new.library_status in ('received','to_review','quarantined') and (new.status_changed_by is null or new.status_changed_by !~ '^user_')
   and exists(select 1 from public.client_visual_items i where i.client_id=new.client_id and i.sha256=new.sha256) then
   update public.whatsapp_assets set library_status='validated',status_changed_at=now(),status_changed_by='visual_agent' where id=new.id;
  end if;
 else
  update public.whatsapp_assets set library_status='validated',status_changed_at=now(),status_changed_by='visual_agent'
  where client_id=new.client_id and sha256=new.sha256 and purged_at is null and library_status in ('received','to_review','quarantined')
   and (status_changed_by is null or status_changed_by !~ '^user_');
 end if;
 return null;
end $$;
revoke all on function publications_private.visual_agent_validate_asset() from public, anon, authenticated;
create trigger whatsapp_assets_visual_agent_validated after insert on public.whatsapp_assets
 for each row execute function publications_private.visual_agent_validate_asset();
create trigger client_visual_items_validate_asset after insert on public.client_visual_items
 for each row execute function publications_private.visual_agent_validate_asset();

-- Visuels déjà importés (quarantaine ou à examiner) : validés de la même façon.
update public.whatsapp_assets a set library_status='validated',status_changed_at=now(),status_changed_by='visual_agent'
from public.client_visual_items i
where i.client_id=a.client_id and i.sha256=a.sha256 and a.purged_at is null and a.library_status in ('received','to_review','quarantined')
 and (a.status_changed_by is null or a.status_changed_by !~ '^user_');
