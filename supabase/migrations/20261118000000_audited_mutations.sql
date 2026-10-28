-- Audit technique du 6 octobre 2026, P1-03 et P1-04.
-- P1-03 : les CRUD historiques (clients, projets, tâches, actions) écrivaient la mutation puis le journal d'audit en
-- deux requêtes ; un échec du journal laissait une mutation commise sans trace (et un nouvel essai ambigu). Désormais
-- une seule RPC transactionnelle fait la mutation ET l'écriture du journal : les deux sont validées ou aucune.
-- P1-04 : création d'action protégée par une unicité SQL (une seule action non annulée par recommandation et type),
-- en plus du précontrôle applicatif. Aucune donnée existante n'est modifiée (aucun doublon en base au moment
-- d'appliquer : l'index échoue s'il en existait, plutôt que de nettoyer automatiquement).

-- P1-04
create unique index if not exists actions_recommendation_type_active_key
 on public.actions(recommendation_id, action_type) where status <> 'cancelled';

-- P1-03
create or replace function public.audited_mutation(
 p_table text, p_operation text, p_id uuid, p_values jsonb, p_expected jsonb,
 p_columns text[], p_audit jsonb, p_audit_columns text[])
returns jsonb language plpgsql set search_path to 'pg_catalog' as $$
declare
 allowed text[]; k text; cols text[]; target_list text; source_list text; cond text := ''; q text;
 before_row jsonb; after_row jsonb; result_row jsonb; actor_type text; actor_id text; resource_id text;
begin
 if p_table is null or p_table not in ('clients','projects','tasks','actions')
  or p_operation is null or p_operation not in ('insert','update','delete')
  or (p_operation <> 'insert' and p_id is null)
  or p_audit is null or jsonb_typeof(p_audit) <> 'object'
  or coalesce(p_audit->>'action','') !~ '^[a-z][a-z_]{0,40}\.[a-z][a-z_.]{0,80}$'
  or coalesce(p_audit->>'resource_type','') !~ '^[a-z][a-z_]{0,40}$'
  or coalesce(p_audit->>'actor_type','') not in ('admin','system')
  or (p_values is not null and jsonb_typeof(p_values) <> 'object')
  or (p_expected is not null and jsonb_typeof(p_expected) <> 'object') then
  raise exception 'Invalid audited mutation' using errcode = '22023';
 end if;
 actor_type := p_audit->>'actor_type';
 actor_id := nullif(p_audit->>'actor_id','');
 if (actor_type = 'admin' and coalesce(actor_id,'') !~ '^user_[a-zA-Z0-9_-]{1,200}$') or (actor_type = 'system' and actor_id is not null) then
  raise exception 'Invalid audit actor' using errcode = '22023';
 end if;
 select array_agg(c.column_name::text) into allowed from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table;
 for k in select jsonb_object_keys(coalesce(p_values,'{}'::jsonb)) union all select jsonb_object_keys(coalesce(p_expected,'{}'::jsonb))
  union all select unnest(coalesce(p_columns,'{}'::text[])) union all select unnest(coalesce(p_audit_columns,'{}'::text[])) loop
  if k is null or not (k = any(allowed)) then raise exception 'Unknown column' using errcode = '22023'; end if;
 end loop;
 if p_operation in ('insert','update') and (p_values is null or p_values = '{}'::jsonb) then
  raise exception 'Nothing to write' using errcode = '22023';
 end if;
 if p_operation = 'insert' and p_values ? 'id' then raise exception 'Id is generated' using errcode = '22023'; end if;
 if p_operation = 'update' and p_values ? 'id' then raise exception 'Id is immutable' using errcode = '22023'; end if;

 select string_agg(format('t.%1$I is not distinct from e.%1$I', key), ' and ') into cond from jsonb_object_keys(coalesce(p_expected,'{}'::jsonb)) as key;
 cond := coalesce(' and ' || cond, '');

 if p_operation = 'insert' then
  cols := array(select jsonb_object_keys(p_values));
  select string_agg(quote_ident(c), ','), string_agg('r.' || quote_ident(c), ',') into target_list, source_list from unnest(cols) c;
  q := format('insert into public.%1$I as t (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I, $1) r returning to_jsonb(t)', p_table, target_list, source_list);
  execute q into after_row using p_values;
 else
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', p_table) into before_row using p_id;
  if before_row is null then return null; end if;
  if p_operation = 'update' then
   select string_agg(format('%1$I = r.%1$I', key), ', ') into target_list from jsonb_object_keys(p_values) as key;
   q := format('update public.%1$I as t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r, jsonb_populate_record(null::public.%1$I, $3) e where t.id = $2%3$s returning to_jsonb(t)',
    p_table, target_list, cond);
   execute q into after_row using p_values, p_id, coalesce(p_expected,'{}'::jsonb);
  else
   q := format('delete from public.%1$I as t using jsonb_populate_record(null::public.%1$I, $2) e where t.id = $1%2$s returning to_jsonb(t)', p_table, cond);
   execute q into after_row using p_id, coalesce(p_expected,'{}'::jsonb);
   if after_row is not null then after_row := null; result_row := before_row; else return null; end if;
  end if;
  -- Condition attendue (statut, version…) non remplie : aucune écriture, aucun journal.
  if p_operation = 'update' and after_row is null then return null; end if;
 end if;

 resource_id := coalesce(nullif(p_audit->>'resource_id',''), coalesce(after_row, before_row)->>'id');
 insert into public.audit_logs(actor_type, actor_id, action, resource_type, resource_id, before_data, after_data, metadata)
 values (actor_type, actor_id, p_audit->>'action', p_audit->>'resource_type', resource_id,
  case when before_row is null then null when p_audit_columns is null then before_row
   else (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(before_row) e where e.key = any(p_audit_columns)) end,
  case when after_row is null then null when p_audit_columns is null then after_row
   else (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(after_row) e where e.key = any(p_audit_columns)) end,
  coalesce(p_audit->'metadata', '{}'::jsonb));

 result_row := coalesce(result_row, after_row);
 if p_columns is null then return result_row; end if;
 return (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(result_row) e where e.key = any(p_columns));
end $$;

revoke all on function public.audited_mutation(text,text,uuid,jsonb,jsonb,text[],jsonb,text[]) from public, anon, authenticated;
grant execute on function public.audited_mutation(text,text,uuid,jsonb,jsonb,text[],jsonb,text[]) to service_role;
