-- Synthetic history only, inserted after Publications Lot 1 and before scope migrations.
do $$ declare publication uuid; revision uuid; variant uuid; account uuid;
begin
 publication:=public.publication_create_manual('10000000-0000-4000-8000-000000000001','2026-09-07',1::smallint,'Synthetic approved historical content','[{"platform":"facebook","text_content":"Fictitious content, never sent externally"}]','user_local_fixture');
 select current_revision_id into revision from public.publications where id=publication;
 select id into variant from public.publication_variants where revision_id=revision;
 perform public.publication_review(publication,revision,variant,'approved',null,'user_local_fixture');
 insert into public.publication_accounts(client_id,platform,external_account_id)
  values('10000000-0000-4000-8000-000000000001','facebook','local-fictitious-account') returning id into account;
 insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key)
  values(publication,'10000000-0000-4000-8000-000000000001',account,variant,'facebook','2026-09-11T10:00:00Z','local-history-only');
end $$;
create temporary table historical_snapshot(table_name text primary key,rows_before jsonb not null);
do $$ declare item record;
begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname loop
  execute format('insert into pg_temp.historical_snapshot select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',item.relname,item.relname);
 end loop;
end $$;
