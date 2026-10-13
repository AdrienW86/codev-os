-- =========================================================================================================
-- PR #40 : vérifications en lecture seule de 20261031000000_publications_supervision.sql
-- À exécuter à tout moment après l'application : n'écrit rien. Chaque ligne doit indiquer ok = true.
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261031000000_publications_supervision.sql (md5 9c1c347088434dc25a532a2e4dd9914a, 7900 octets).
-- =========================================================================================================
select controle, ok from (values
 ('fonction public.publication_reschedule(uuid,uuid,uuid,text) : présente, code identique au dépôt', coalesce((coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'))='973dd25bbf298ededa3846a120364c58',false)), false)),
 ('fonction public.publication_reschedule(uuid,uuid,uuid,text) : SECURITY INVOKER, search_path search_path=pg_catalog', coalesce((coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)')),false)), false)),
 ('fonction public.publication_reschedule(uuid,uuid,uuid,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role', coalesce((coalesce(not has_function_privilege('public',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_reschedule(uuid,uuid,uuid,text)'),'EXECUTE')=true,false)), false)),
 ('historique : publications_supervision inscrite avec le texte du dépôt', coalesce((exists(select 1 from supabase_migrations.schema_migrations where name='publications_supervision' and md5(statements[1])='9c1c347088434dc25a532a2e4dd9914a')), false)),
 ('publication : arrêt d''urgence toujours actif, aucun client en préparation automatique', coalesce(((select bool_and(emergency_stop) from public.publication_settings) and not exists(select 1 from public.publication_client_settings where auto_prepare_enabled)), false))
) v(controle, ok);
