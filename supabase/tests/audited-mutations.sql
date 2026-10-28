-- Audit technique P1-03 / P1-04 : mutation et journal d'audit dans la même transaction ; unicité des actions actives.
-- Base locale jetable uniquement. Assertions PostgreSQL séquentielles.
begin;
create or replace function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Check failed: %',label; end if; end $$;
select pg_temp.check_true(not has_function_privilege('anon','public.audited_mutation(text,text,uuid,jsonb,jsonb,text[],jsonb,text[])','EXECUTE'),'anon cannot call audited_mutation');
select pg_temp.check_true(not has_function_privilege('authenticated','public.audited_mutation(text,text,uuid,jsonb,jsonb,text[],jsonb,text[])','EXECUTE'),'browser cannot call audited_mutation');

-- Création : ligne + journal, colonnes projetées.
create temporary table created as select public.audited_mutation('clients','insert',null,'{"name":"Client audit test"}'::jsonb,null,array['id','name'],
 '{"action":"client.created","resource_type":"client","actor_type":"admin","actor_id":"user_audit_test","metadata":{}}'::jsonb,array['id','name']) r;
select pg_temp.check_true((select r->>'name' from created)='Client audit test','insert returns the row');
select pg_temp.check_true((select count(*) from public.audit_logs where action='client.created' and resource_id=(select r->>'id' from created) and after_data->>'name'='Client audit test' and before_data is null)=1,'insert is audited once');

-- Modification avec condition attendue : écrite et journalisée ; condition non remplie : rien, pas de journal.
select pg_temp.check_true(public.audited_mutation('clients','update',(r->>'id')::uuid,'{"name":"Client renommé"}'::jsonb,'{"name":"Client audit test"}'::jsonb,array['name'],
 '{"action":"client.updated","resource_type":"client","actor_type":"admin","actor_id":"user_audit_test"}'::jsonb,null)->>'name'='Client renommé','update applies') from created;
select pg_temp.check_true(public.audited_mutation('clients','update',(r->>'id')::uuid,'{"name":"Autre"}'::jsonb,'{"name":"Client audit test"}'::jsonb,null,
 '{"action":"client.updated","resource_type":"client","actor_type":"admin","actor_id":"user_audit_test"}'::jsonb,null) is null,'stale expectation writes nothing') from created;
select pg_temp.check_true((select count(*) from public.audit_logs where action='client.updated')=1,'only the applied update is audited');
select pg_temp.check_true((select name from public.clients where id=(select (r->>'id')::uuid from created))='Client renommé','stale update left the row unchanged');

-- Échec du journal (acteur invalide) : la mutation est annulée avec lui.
do $$ begin
 perform public.audited_mutation('clients','update',(select (r->>'id')::uuid from created),'{"name":"Sans trace"}'::jsonb,null,null,
  '{"action":"client.updated","resource_type":"client","actor_type":"admin","actor_id":"not-a-user"}'::jsonb,null);
 raise exception 'expected invalid actor';
 exception when invalid_parameter_value then null;
end $$;
select pg_temp.check_true((select name from public.clients where id=(select (r->>'id')::uuid from created))='Client renommé','refused audit leaves no mutation');

-- Table ou colonne hors liste : refusé avant toute écriture.
do $$ begin
 perform public.audited_mutation('audit_logs','insert',null,'{"action":"x.y"}'::jsonb,null,null,'{"action":"x.y","resource_type":"x","actor_type":"system"}'::jsonb,null);
 raise exception 'expected table refusal';
 exception when invalid_parameter_value then null;
end $$;
do $$ begin
 perform public.audited_mutation('clients','update',(select (r->>'id')::uuid from created),'{"nope":"x"}'::jsonb,null,null,'{"action":"client.updated","resource_type":"client","actor_type":"system"}'::jsonb,null);
 raise exception 'expected column refusal';
 exception when invalid_parameter_value then null;
end $$;

-- Suppression : renvoie la ligne supprimée, journal avant/après ; deuxième suppression : rien.
select pg_temp.check_true(public.audited_mutation('clients','delete',(r->>'id')::uuid,null,null,array['id'],
 '{"action":"client.deleted","resource_type":"client","actor_type":"admin","actor_id":"user_audit_test"}'::jsonb,null)->>'id'=(r->>'id'),'delete returns the deleted row') from created;
select pg_temp.check_true((select count(*) from public.audit_logs where action='client.deleted' and after_data is null and before_data->>'name'='Client renommé')=1,'delete is audited');
select pg_temp.check_true(public.audited_mutation('clients','delete',(r->>'id')::uuid,null,null,null,
 '{"action":"client.deleted","resource_type":"client","actor_type":"admin","actor_id":"user_audit_test"}'::jsonb,null) is null,'second delete is a no-op') from created;

-- P1-04 : une seule action non annulée par recommandation et type.
select pg_temp.check_true(exists(select 1 from pg_indexes where schemaname='public' and indexname='actions_recommendation_type_active_key'),'active action uniqueness index');
rollback;
