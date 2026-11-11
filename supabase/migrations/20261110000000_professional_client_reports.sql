-- Rapports personnalisés : élargissement additif, sans mise à jour des rapports historiques.
-- Aucune application de cette migration en production pendant la mission.
alter table public.reports drop constraint reports_kind_check;
alter table public.reports add constraint reports_kind_check
  check (kind in ('weekly', 'monthly', 'google_ads', 'custom'));

-- L'identifiant de la demande est aussi la clé primaire du document : deux soumissions
-- concurrentes de la même préparation ne créent jamais deux rapports.
alter table public.reports add constraint reports_custom_scope_check check (
  kind <> 'custom' or coalesce(
    client_id is not null
    and scope ->> 'clientId' = client_id::text
    and scope ->> 'requestId' = id::text
    and scope ->> 'start' = period_start::text
    and scope ->> 'end' = period_end::text
    and period_end - period_start between 0 and 365
    and scope ->> 'family' in ('global','ads','seo','website','activity')
    and case when jsonb_typeof(scope -> 'sources') = 'array' then
      jsonb_array_length(scope -> 'sources') between 1 and 4
      and (scope -> 'sources') <@ '["google_ads","search_console","website","activity"]'::jsonb
      -- JSONB containment ignores repeated array values: count the distinct known
      -- sources explicitly so a repeated source cannot pass the SQL boundary.
      and jsonb_array_length(scope -> 'sources') =
        ((scope -> 'sources') @> '["google_ads"]'::jsonb)::integer
        + ((scope -> 'sources') @> '["search_console"]'::jsonb)::integer
        + ((scope -> 'sources') @> '["website"]'::jsonb)::integer
        + ((scope -> 'sources') @> '["activity"]'::jsonb)::integer
      and case scope ->> 'family'
        when 'global' then true
        when 'ads' then scope -> 'sources' = '["google_ads"]'::jsonb
        when 'seo' then scope -> 'sources' = '["search_console"]'::jsonb
        when 'website' then scope -> 'sources' = '["website"]'::jsonb
        when 'activity' then scope -> 'sources' = '["activity"]'::jsonb
        else false
      end
    else false end,
    false
  )
);

create function codev_private.professional_report_scope_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (old.kind = 'custom' or new.kind = 'custom') and (
    new.kind is distinct from old.kind or new.client_id is distinct from old.client_id
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.scope is distinct from old.scope
  ) then
    raise exception 'Client report scope is immutable' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger professional_report_scope_guard before update on public.reports
  for each row execute function codev_private.professional_report_scope_guard();
revoke all on function codev_private.professional_report_scope_guard() from public, anon, authenticated;
grant execute on function codev_private.professional_report_scope_guard() to service_role;

-- Son absence désactive explicitement le formulaire sur les bases non migrées.
create function public.codev_professional_reporting_ready() returns boolean
language sql stable security invoker set search_path = pg_catalog as $$ select true $$;
revoke all on function public.codev_professional_reporting_ready() from public, anon, authenticated;
grant execute on function public.codev_professional_reporting_ready() to service_role;
notify pgrst, 'reload schema';
