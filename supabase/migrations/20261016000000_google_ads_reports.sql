-- Rapports Google Ads à périmètre explicite (additif, aucune donnée modifiée ni supprimée).
--
-- Pourquoi : un rapport Google Ads couvre une période et une sélection de campagnes choisies dans le
-- tableau de bord. Ce périmètre doit être enregistré avec le rapport et chacune de ses versions, et ne
-- jamais changer ensuite (les filtres du tableau de bord ne modifient jamais un rapport existant).
--
-- Ce que la migration fait :
-- 1. ajoute reports.scope (jsonb, '{}' par défaut : les rapports hebdomadaires/mensuels existants sont inchangés) ;
-- 2. ajoute report_versions.scope (nullable : les versions existantes restent telles quelles) ;
-- 3. élargit la contrainte de type à 'google_ads' (sur-ensemble de l'ancienne : aucune ligne existante invalidée) ;
-- 4. restreint l'unicité (client, type, début de période) aux rapports hebdomadaires/mensuels, via un index
--    unique partiel équivalent pour ces types : plusieurs rapports Google Ads peuvent couvrir la même période
--    avec des campagnes différentes. Le comportement des rapports récurrents est strictement identique ;
-- 5. fige le périmètre, la période, le type et le client d'un rapport Google Ads (trigger).
-- Les contraintes remplacées sont supprimées puis recréées dans la même transaction : aucun drop de données.

alter table public.reports
  add column if not exists scope jsonb not null default '{}'::jsonb;

alter table public.reports
  add constraint reports_scope_check check (jsonb_typeof(scope) = 'object' and pg_column_size(scope) <= 16384);

alter table public.reports drop constraint reports_kind_check;
alter table public.reports
  add constraint reports_kind_check check (kind in ('weekly', 'monthly', 'google_ads'));

-- Un rapport Google Ads porte toujours son périmètre, cohérent avec la période enregistrée.
alter table public.reports
  add constraint reports_google_ads_scope_check check (
    kind <> 'google_ads' or coalesce(
      jsonb_typeof(scope -> 'campaignIds') = 'array'
      and jsonb_array_length(scope -> 'campaignIds') between 1 and 50
      and scope ->> 'start' = period_start::text
      and scope ->> 'end' = period_end::text,
      false
    )
  );

alter table public.reports drop constraint reports_unique_period;
create unique index reports_unique_recurring_period on public.reports (client_id, kind, period_start) nulls not distinct
  where kind in ('weekly', 'monthly');
create index if not exists reports_kind_period_idx on public.reports (kind, period_start desc);

alter table public.report_versions
  add column if not exists scope jsonb check (scope is null or (jsonb_typeof(scope) = 'object' and pg_column_size(scope) <= 16384));

-- Périmètre figé : seule une nouvelle version (même périmètre) ou un changement de statut est possible.
create function codev_private.reports_scope_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (old.kind = 'google_ads' or new.kind = 'google_ads') and (
    new.kind is distinct from old.kind
    or new.client_id is distinct from old.client_id
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.scope is distinct from old.scope
  ) then
    raise exception 'Google Ads report scope is immutable' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger reports_scope_guard before update on public.reports for each row execute function codev_private.reports_scope_guard();
revoke all on function codev_private.reports_scope_guard() from public, anon, authenticated;
grant execute on function codev_private.reports_scope_guard() to service_role;

notify pgrst, 'reload schema';
