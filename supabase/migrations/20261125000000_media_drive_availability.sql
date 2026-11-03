-- Photothèque : une photo dont l'original a été mis à la corbeille ou retiré de son dossier Drive quitte la photothèque
-- (plus jamais proposée à l'agent Publications, au Studio ni à la revue). Vérification planifiée, par lots.
-- Le retrait est réversible : si le fichier réapparaît dans le dossier (restauré de la corbeille), la photo revient.
-- Contrairement à la purge des médias rejetés, rien n'est effacé (légende, miniature) : seul l'accès est retiré.
alter table public.whatsapp_assets
  add column drive_checked_at timestamptz,
  add column drive_missing_at timestamptz,
  add constraint whatsapp_assets_drive_missing_purged check(drive_missing_at is null or purged_at is not null);
create index whatsapp_assets_drive_check_idx on public.whatsapp_assets(drive_checked_at nulls first,created_at)
  where purged_at is null and imported_at is not null;

create function public.whatsapp_asset_mark_drive_missing(p_asset_id uuid,p_client_id uuid) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 update public.whatsapp_assets set purged_at=now(),drive_missing_at=now(),drive_checked_at=now()
 where id=p_asset_id and client_id=p_client_id and purged_at is null and imported_at is not null;
 if not found then return false; end if;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.drive_missing','system',null,'client',p_client_id,jsonb_build_object('asset_id',p_asset_id));
 return true;
end $$;

-- Retour d'une photo retirée pour absence Drive (jamais d'une photo purgée après rejet humain).
create function public.whatsapp_asset_restore_drive(p_asset_id uuid,p_client_id uuid) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 update public.whatsapp_assets set purged_at=null,drive_missing_at=null,drive_checked_at=now()
 where id=p_asset_id and client_id=p_client_id and drive_missing_at is not null;
 if not found then return false; end if;
 insert into public.audit_logs(action,actor_type,actor_id,resource_type,resource_id,metadata)
 values('whatsapp.library.drive_restored','system',null,'client',p_client_id,jsonb_build_object('asset_id',p_asset_id));
 return true;
end $$;

revoke all on function public.whatsapp_asset_mark_drive_missing(uuid,uuid), public.whatsapp_asset_restore_drive(uuid,uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_asset_mark_drive_missing(uuid,uuid), public.whatsapp_asset_restore_drive(uuid,uuid) to service_role;
