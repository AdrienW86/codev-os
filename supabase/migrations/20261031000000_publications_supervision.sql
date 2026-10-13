-- Socle Publications, lot 7 : supervision. Une seule fonction ajoutée, « Reprogrammer ». Aucune table modifiée.
--
-- Les liaisons occurrence ↔ publication restent immuables (P3/P4) : reprogrammer ne déplace rien. Comme la
-- planification d'un brouillon (#34), une nouvelle publication est créée sur l'occurrence OUVERTE choisie (même
-- client, projet et plateforme, à venir), par la logique de création unique, avec le texte, les métadonnées et les
-- médias de la révision actuelle ; l'ancienne est archivée (consultable, son créneau reste consommé) et liée par le
-- journal. Approbation : toujours remise à zéro. Une publication en attente ou approuvée repasse « À valider » ; un
-- brouillon reste brouillon. Les diffusions non envoyées sont annulées ; une diffusion en cours, envoyée ou à
-- vérifier bloque la reprogrammation. Une publication refusée n'est jamais reprogrammée. Forward-only.
-- Photothèque (lot 4-5) : une photo de la photothèque du client attachée à la publication (historique
-- whatsapp_asset_uses) doit être encore publiable (publications_private.library_asset_publishable) ; sinon refus clair,
-- rien n'est modifié. L'historique d'utilisation suit la nouvelle publication. Une publication qui repasse « À valider »
-- crée la notification de validation (catégorie publication_review du lot 6, idempotente par publication).
-- Groupe éditorial : non repris. L'ancienne publication (archivée) garde sa liaison immuable au groupe et sur la
-- même plateforme ; l'index unique (groupe, plateforme) interdit donc d'y rattacher la nouvelle sans modifier le socle.
create function public.publication_reschedule(p_publication_id uuid,p_expected_revision_id uuid,p_occurrence_id uuid,p_actor_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;rev public.publication_revisions;v public.publication_variants;occ public.publication_channel_occurrences;
 created jsonb;new_id uuid;new_revision uuid;new_variant uuid;d uuid;cancelled uuid[]:='{}';
 lib public.whatsapp_assets;lib_id uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null or p_expected_revision_id is null or p_occurrence_id is null then
  raise exception 'Invalid reschedule' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale publication' using errcode='40001'; end if;
 if pub.archived_at is not null then raise exception 'Archived publication' using errcode='55000'; end if;
 if pub.occurrence_id is null or pub.platform is null or pub.project_id is null then raise exception 'Publication not scheduled' using errcode='55000'; end if;
 if pub.status not in('draft','pending_review','approved') then raise exception 'Publication cannot be rescheduled' using errcode='55000'; end if;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status in('processing','published','simulated','uncertain')) then
  raise exception 'Resolve deliveries first' using errcode='55000'; end if;
 select * into occ from public.publication_channel_occurrences where id=p_occurrence_id for update;
 if not found or occ.id=pub.occurrence_id or occ.client_id<>pub.client_id or occ.project_id<>pub.project_id or occ.platform<>pub.platform then
  raise exception 'Invalid occurrence' using errcode='23514'; end if;
 if occ.skipped_at is not null then raise exception 'Occurrence skipped' using errcode='23514'; end if;
 if occ.publication_id is not null then raise exception 'Occurrence already has a publication' using errcode='23505'; end if;
 if occ.scheduled_for<=now() then raise exception 'Occurrence in the past' using errcode='23514'; end if;
 select * into rev from public.publication_revisions where id=pub.current_revision_id;
 select * into v from public.publication_variants where revision_id=pub.current_revision_id and platform=pub.platform;
 if not found then raise exception 'Variant missing' using errcode='23514'; end if;
 -- Photos de la photothèque attachées : toujours publiables (confidentielle, rejetée, archivée, purgée, hors sujet → refus).
 for lib_id in select distinct u.asset_id from public.publication_variant_assets va
   join public.whatsapp_asset_uses u on u.publication_asset_id=va.asset_id and u.client_id=va.client_id where va.variant_id=v.id loop
  select * into lib from public.whatsapp_assets where id=lib_id and client_id=pub.client_id;
  if not publications_private.library_asset_publishable(lib) then
   raise exception 'Library photo no longer publishable' using errcode='23514'; end if;
 end loop;

 -- Diffusions pas encore envoyées : annulées par la fonction existante (jobs compris, journalisées).
 for d in select id from public.publication_deliveries where publication_id=pub.id and status in('scheduled','retryable_error','blocked') order by id loop
  perform public.publication_delivery_cancel(d,p_actor_id);cancelled:=cancelled||d;
 end loop;

 created:=publications_private.create_publication_from_occurrence(occ.id,null,null,pub.subject,rev.angle,v.text_content,v.metadata,p_actor_id,'manual');
 new_id:=(created->>'publication_id')::uuid;new_revision:=(created->>'revision_id')::uuid;
 select id into new_variant from public.publication_variants where revision_id=new_revision;
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order)
  select new_variant,va.asset_id,va.client_id,va.sort_order from public.publication_variant_assets va where va.variant_id=v.id order by va.sort_order;
 -- Historique de la photothèque : la nouvelle publication réutilise les mêmes fichiers privés (une ligne par photo).
 insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,publication_asset_id,used_by)
  select distinct on (u.asset_id) u.asset_id,u.client_id,new_id,pub.platform,u.publication_asset_id,p_actor_id
  from public.publication_variant_assets va join public.whatsapp_asset_uses u on u.publication_asset_id=va.asset_id and u.client_id=va.client_id
  where va.variant_id=v.id order by u.asset_id,va.sort_order
 on conflict(asset_id,publication_id,platform) do nothing;
 perform public.publication_archive(pub.id,p_actor_id);
 if pub.status in('pending_review','approved') then
  perform public.publication_submit_manual(new_id,new_revision,p_actor_id);
  -- « À valider » : même notification que la préparation planifiée (aucun texte ni nom de client).
  insert into public.admin_notifications(event_key,category,href) values('publication-review:'||new_id::text,'publication_review','/publications/review')
  on conflict(event_key) do nothing;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.rescheduled',pub.client_id,'publication',pub.id,jsonb_build_object('project_id',pub.project_id,
  'from_occurrence_id',pub.occurrence_id,'to_occurrence_id',occ.id,'publication_id',new_id,'revision_id',new_revision,'source_revision_id',pub.current_revision_id,
  'previous_status',pub.status,'approval_reset',pub.status='approved','cancelled_deliveries',to_jsonb(cancelled)));
 return jsonb_build_object('publication_id',new_id,'revision_id',new_revision,'status',case when pub.status='draft' then 'draft' else 'pending_review' end,
  'archived_source_id',pub.id,'cancelled_deliveries',to_jsonb(cancelled));
end $$;
revoke all on function public.publication_reschedule(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.publication_reschedule(uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
