create temporary table historical_checks(passed integer not null);
insert into historical_checks values(0);
do $$ declare item record; rows_after jsonb; remove_keys text[];
begin
 for item in select * from pg_temp.historical_snapshot order by table_name loop
  remove_keys:=case
   when item.table_name='agents' then array['agent_scope','scope_review_required']
   when item.table_name in ('agent_runs','recommendations','actions','agent_messages','publications','publication_revisions') then array['project_id']
   when item.table_name='tasks' then array['completed_at']
   when item.table_name='publication_deliveries' then array['published_at']
   else array[]::text[] end;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)-$1 order by (to_jsonb(t)-$1)::text),''[]''::jsonb) from public.%I t',item.table_name) into rows_after using remove_keys;
  if rows_after is distinct from item.rows_before then raise exception 'Historical data changed/lost in %',item.table_name; end if;
  update pg_temp.historical_checks set passed=passed+1;
 end loop;
 if (select passed from pg_temp.historical_checks)<>25 then raise exception 'Historical snapshot must cover all 25 pre-scope tables'; end if;
end $$;
-- All new context columns stay NULL: no historical project attribution is invented.
do $$ declare name text; incorrect bigint;
begin
 foreach name in array array['agent_runs','recommendations','actions','agent_messages','publications','publication_revisions'] loop
  execute format('select count(*) from public.%I where project_id is not null',name) into incorrect;
  if incorrect<>0 then raise exception 'Invented historical project on %',name; end if;
  update pg_temp.historical_checks set passed=passed+1;
 end loop;
end $$;
