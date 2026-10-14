-- Socle Publications, PR #42 : intelligence éditoriale de l'Agent v2. Migration additive.
-- 1. Justification éditoriale d'une préparation (pourquoi ce sujet, cette photo, quel historique a été considéré, quelles
--    prestations ont été écartées et pourquoi, ou motif du refus) enregistrée avec le run, en lecture seule ensuite.
-- 2. Index de lecture « run d'une publication » pour le panneau de la publication.
-- Aucune ligne existante n'est modifiée (colonne nullable sans défaut) ; rien n'est activé ; aucune publication.

-- 1. Colonne : objet JSON borné (16 000 octets), posé une seule fois, uniquement pendant la préparation.
alter table public.publication_agent_v2_runs
 add column editorial_justification jsonb
 constraint publication_agent_v2_runs_justification_shape check(editorial_justification is null
  or (jsonb_typeof(editorial_justification)='object' and octet_length(editorial_justification::text)<=16000));
create index publication_agent_v2_runs_publications on public.publication_agent_v2_runs using gin(publication_ids);

-- Immuable : jamais modifiée une fois posée, jamais posée après la fin du run (le garde historique du run reste inchangé).
create function publications_private.guard_agent_v2_justification() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if new.editorial_justification is distinct from old.editorial_justification
  and (old.editorial_justification is not null or old.status<>'processing') then
  raise exception 'Editorial justification is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger agent_v2_run_justification_guard before update of editorial_justification on public.publication_agent_v2_runs
 for each row execute function publications_private.guard_agent_v2_justification();

-- 2. Enregistrement par le serveur (Agent v2), avant la fin du run : version, issue et contenu bornés.
create function public.publication_editorial_justification_record(p_run_id uuid,p_justification jsonb,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.publication_agent_v2_runs;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_run_id is null or p_justification is null
  or jsonb_typeof(p_justification) is distinct from 'object' or octet_length(p_justification::text)>16000
  or jsonb_typeof(p_justification->'version') is distinct from 'number'
  or coalesce(p_justification->>'outcome','') not in('prepared','refused') then
  raise exception 'Invalid editorial justification' using errcode='22023'; end if;
 select * into r from public.publication_agent_v2_runs where id=p_run_id for update;
 if r.id is null then raise exception 'Agent run not found' using errcode='22023'; end if;
 if r.status<>'processing' or r.editorial_justification is not null then
  raise exception 'Editorial justification is immutable' using errcode='55000'; end if;
 update public.publication_agent_v2_runs set editorial_justification=p_justification where id=r.id;
 return jsonb_build_object('run_id',r.id,'recorded',true);
end $$;

-- 3. Droits : service_role uniquement.
revoke all on function publications_private.guard_agent_v2_justification() from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_agent_v2_justification() to service_role;
revoke all on function public.publication_editorial_justification_record(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_editorial_justification_record(uuid,jsonb,text) to service_role;
notify pgrst, 'reload schema';
