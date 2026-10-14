-- Brouillons non planifiés (photothèque WhatsApp). Migration additive : aucune ligne existante n'est modifiée.
-- Un brouillon non planifié ne réserve aucun des deux créneaux éditoriaux de la semaine (slot NULL, sans occurrence).
-- Les index d'unicité de créneau ignorent déjà les NULL, la recherche de créneau libre et la liaison au calendrier
-- comparent slot = valeur : elles ne voient pas ces brouillons. L'identité éditoriale (client, semaine, créneau) reste
-- immuable : un brouillon non planifié ne prend jamais un créneau a posteriori par simple mise à jour.
-- Aucune livraison ne peut être préparée tant qu'une publication n'a ni créneau ni occurrence de calendrier.

alter table public.publications alter column slot drop not null;
-- Seules les publications de projet, hors groupe éditorial, peuvent être non planifiées.
alter table public.publications add constraint publications_unscheduled_scope
 check (slot is not null or (project_id is not null and editorial_group_id is null));

create function public.publication_save_unscheduled_draft(p_client_id uuid,p_project_id uuid,p_title text,p_angle text,p_source text,p_variants jsonb,p_actor_id text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare saved_id uuid;revision uuid;week date;item public.publication_variants;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or coalesce(length(btrim(p_title)),0) not between 1 and 300 or coalesce(length(btrim(p_angle)),0) not between 1 and 3000 or coalesce(length(btrim(p_source)),0) not between 1 and 20000 then raise exception 'Invalid draft' using errcode='22023';end if;
 if p_project_id is null or not exists(select 1 from public.projects where projects.id=p_project_id and client_id=p_client_id and type in('Réseaux sociaux','Google Business Profile')) then raise exception 'Invalid client/project' using errcode='23514';end if;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',btrim(p_title),'angle',btrim(p_angle),'source',btrim(p_source),'target_date',null,'actor',p_actor_id,'project',p_project_id)::text,true);
 -- Semaine de création, à titre d'information : sans créneau, elle ne compte dans aucune limite hebdomadaire.
 week:=date_trunc('week',current_date::timestamp)::date;
 saved_id:=public.publication_create_project_manual(p_client_id,p_project_id,week,null,p_title,p_variants,p_actor_id);
 update public.publications set subject=btrim(p_title),target_date=null,status='draft' where publications.id=saved_id;
 select current_revision_id into revision from public.publications where publications.id=saved_id;
 for item in select * from public.publication_variants where revision_id=revision loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.variant_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'variant_id',item.id,'platform',item.platform));
 end loop;
 perform set_config('codev.publication_editorial','',true);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.draft_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'unscheduled',true));
 return saved_id;
end $$;
revoke all on function public.publication_save_unscheduled_draft(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_save_unscheduled_draft(uuid,uuid,text,text,text,jsonb,text) to service_role;

create function publications_private.guard_unscheduled_delivery() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publications p where p.id=new.publication_id and p.slot is null and p.occurrence_id is null) then
  raise exception 'Unscheduled publication' using errcode='55000';
 end if;
 return new;
end $$;
create trigger publication_deliveries_unscheduled before insert on public.publication_deliveries
 for each row execute function publications_private.guard_unscheduled_delivery();
