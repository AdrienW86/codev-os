-- =========================================================================================================
-- PR #42 : inscription de 20261102000000_publications_editorial_intelligence.sql dans l'historique Supabase
-- À exécuter APRÈS une application réussie de apply_sql_editor.sql, dans une nouvelle requête du SQL Editor.
-- Convention de l'historique de ce projet : version = horodatage UTC de l'inscription, nom court (publications_editorial_intelligence), texte dans statements.
-- Refuse d'écrire si la migration n'est pas réellement en place (mêmes contrôles qu'après application) ou si elle est
-- déjà inscrite. Le texte inscrit est le fichier du dépôt, transporté en base64 : un copier-coller qui change les fins
-- de ligne (CRLF sous Windows) ou l'encodage ne peut pas l'altérer. Les corps de fonctions en base sont comparés à
-- ceux du dépôt en ignorant seulement les fins de ligne. Une seule transaction : en cas d'anomalie, rien n'est écrit.
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261102000000_publications_editorial_intelligence.sql (md5 3b2de8f168d15f3ea1625cb634f47d4e, 3667 octets).
-- =========================================================================================================
begin;
do $sync$
declare
 expected_md5 constant text := '3b2de8f168d15f3ea1625cb634f47d4e';
 migration_text text := convert_from(decode('
LS0gU29jbGUgUHVibGljYXRpb25zLCBQUiAjNDIgOiBpbnRlbGxpZ2VuY2Ugw6lkaXRvcmlhbGUg
ZGUgbCdBZ2VudCB2Mi4gTWlncmF0aW9uIGFkZGl0aXZlLgotLSAxLiBKdXN0aWZpY2F0aW9uIMOp
ZGl0b3JpYWxlIGQndW5lIHByw6lwYXJhdGlvbiAocG91cnF1b2kgY2Ugc3VqZXQsIGNldHRlIHBo
b3RvLCBxdWVsIGhpc3RvcmlxdWUgYSDDqXTDqSBjb25zaWTDqXLDqSwgcXVlbGxlcwotLSAgICBw
cmVzdGF0aW9ucyBvbnQgw6l0w6kgw6ljYXJ0w6llcyBldCBwb3VycXVvaSwgb3UgbW90aWYgZHUg
cmVmdXMpIGVucmVnaXN0csOpZSBhdmVjIGxlIHJ1biwgZW4gbGVjdHVyZSBzZXVsZSBlbnN1aXRl
LgotLSAyLiBJbmRleCBkZSBsZWN0dXJlIMKrIHJ1biBkJ3VuZSBwdWJsaWNhdGlvbiDCuyBwb3Vy
IGxlIHBhbm5lYXUgZGUgbGEgcHVibGljYXRpb24uCi0tIEF1Y3VuZSBsaWduZSBleGlzdGFudGUg
bidlc3QgbW9kaWZpw6llIChjb2xvbm5lIG51bGxhYmxlIHNhbnMgZMOpZmF1dCkgOyByaWVuIG4n
ZXN0IGFjdGl2w6kgOyBhdWN1bmUgcHVibGljYXRpb24uCgotLSAxLiBDb2xvbm5lIDogb2JqZXQg
SlNPTiBib3Juw6kgKDE2IDAwMCBvY3RldHMpLCBwb3PDqSB1bmUgc2V1bGUgZm9pcywgdW5pcXVl
bWVudCBwZW5kYW50IGxhIHByw6lwYXJhdGlvbi4KYWx0ZXIgdGFibGUgcHVibGljLnB1YmxpY2F0
aW9uX2FnZW50X3YyX3J1bnMKIGFkZCBjb2x1bW4gZWRpdG9yaWFsX2p1c3RpZmljYXRpb24ganNv
bmIKIGNvbnN0cmFpbnQgcHVibGljYXRpb25fYWdlbnRfdjJfcnVuc19qdXN0aWZpY2F0aW9uX3No
YXBlIGNoZWNrKGVkaXRvcmlhbF9qdXN0aWZpY2F0aW9uIGlzIG51bGwKICBvciAoanNvbmJfdHlw
ZW9mKGVkaXRvcmlhbF9qdXN0aWZpY2F0aW9uKT0nb2JqZWN0JyBhbmQgb2N0ZXRfbGVuZ3RoKGVk
aXRvcmlhbF9qdXN0aWZpY2F0aW9uOjp0ZXh0KTw9MTYwMDApKTsKY3JlYXRlIGluZGV4IHB1Ymxp
Y2F0aW9uX2FnZW50X3YyX3J1bnNfcHVibGljYXRpb25zIG9uIHB1YmxpYy5wdWJsaWNhdGlvbl9h
Z2VudF92Ml9ydW5zIHVzaW5nIGdpbihwdWJsaWNhdGlvbl9pZHMpOwoKLS0gSW1tdWFibGUgOiBq
YW1haXMgbW9kaWZpw6llIHVuZSBmb2lzIHBvc8OpZSwgamFtYWlzIHBvc8OpZSBhcHLDqHMgbGEg
ZmluIGR1IHJ1biAobGUgZ2FyZGUgaGlzdG9yaXF1ZSBkdSBydW4gcmVzdGUgaW5jaGFuZ8OpKS4K
Y3JlYXRlIGZ1bmN0aW9uIHB1YmxpY2F0aW9uc19wcml2YXRlLmd1YXJkX2FnZW50X3YyX2p1c3Rp
ZmljYXRpb24oKSByZXR1cm5zIHRyaWdnZXIKbGFuZ3VhZ2UgcGxwZ3NxbCBzZWN1cml0eSBpbnZv
a2VyIHNldCBzZWFyY2hfcGF0aD1wZ19jYXRhbG9nIGFzICQkCmJlZ2luCiBpZiBuZXcuZWRpdG9y
aWFsX2p1c3RpZmljYXRpb24gaXMgZGlzdGluY3QgZnJvbSBvbGQuZWRpdG9yaWFsX2p1c3RpZmlj
YXRpb24KICBhbmQgKG9sZC5lZGl0b3JpYWxfanVzdGlmaWNhdGlvbiBpcyBub3QgbnVsbCBvciBv
bGQuc3RhdHVzPD4ncHJvY2Vzc2luZycpIHRoZW4KICByYWlzZSBleGNlcHRpb24gJ0VkaXRvcmlh
bCBqdXN0aWZpY2F0aW9uIGlzIGltbXV0YWJsZScgdXNpbmcgZXJyY29kZT0nNTUwMDAnOyBlbmQg
aWY7CiByZXR1cm4gbmV3OwplbmQgJCQ7CmNyZWF0ZSB0cmlnZ2VyIGFnZW50X3YyX3J1bl9qdXN0
aWZpY2F0aW9uX2d1YXJkIGJlZm9yZSB1cGRhdGUgb2YgZWRpdG9yaWFsX2p1c3RpZmljYXRpb24g
b24gcHVibGljLnB1YmxpY2F0aW9uX2FnZW50X3YyX3J1bnMKIGZvciBlYWNoIHJvdyBleGVjdXRl
IGZ1bmN0aW9uIHB1YmxpY2F0aW9uc19wcml2YXRlLmd1YXJkX2FnZW50X3YyX2p1c3RpZmljYXRp
b24oKTsKCi0tIDIuIEVucmVnaXN0cmVtZW50IHBhciBsZSBzZXJ2ZXVyIChBZ2VudCB2MiksIGF2
YW50IGxhIGZpbiBkdSBydW4gOiB2ZXJzaW9uLCBpc3N1ZSBldCBjb250ZW51IGJvcm7DqXMuCmNy
ZWF0ZSBmdW5jdGlvbiBwdWJsaWMucHVibGljYXRpb25fZWRpdG9yaWFsX2p1c3RpZmljYXRpb25f
cmVjb3JkKHBfcnVuX2lkIHV1aWQscF9qdXN0aWZpY2F0aW9uIGpzb25iLHBfYWN0b3JfaWQgdGV4
dCkgcmV0dXJucyBqc29uYgpsYW5ndWFnZSBwbHBnc3FsIHNlY3VyaXR5IGludm9rZXIgc2V0IHNl
YXJjaF9wYXRoPXBnX2NhdGFsb2cgYXMgJCQKZGVjbGFyZSByIHB1YmxpYy5wdWJsaWNhdGlvbl9h
Z2VudF92Ml9ydW5zOwpiZWdpbgogaWYgcF9hY3Rvcl9pZCBpcyBudWxsIG9yIHBfYWN0b3JfaWQg
IX4gJ151c2VyX1thLXpBLVowLTlfLV17MSwyMDB9JCcgb3IgcF9ydW5faWQgaXMgbnVsbCBvciBw
X2p1c3RpZmljYXRpb24gaXMgbnVsbAogIG9yIGpzb25iX3R5cGVvZihwX2p1c3RpZmljYXRpb24p
IGlzIGRpc3RpbmN0IGZyb20gJ29iamVjdCcgb3Igb2N0ZXRfbGVuZ3RoKHBfanVzdGlmaWNhdGlv
bjo6dGV4dCk+MTYwMDAKICBvciBqc29uYl90eXBlb2YocF9qdXN0aWZpY2F0aW9uLT4ndmVyc2lv
bicpIGlzIGRpc3RpbmN0IGZyb20gJ251bWJlcicKICBvciBjb2FsZXNjZShwX2p1c3RpZmljYXRp
b24tPj4nb3V0Y29tZScsJycpIG5vdCBpbigncHJlcGFyZWQnLCdyZWZ1c2VkJykgdGhlbgogIHJh
aXNlIGV4Y2VwdGlvbiAnSW52YWxpZCBlZGl0b3JpYWwganVzdGlmaWNhdGlvbicgdXNpbmcgZXJy
Y29kZT0nMjIwMjMnOyBlbmQgaWY7CiBzZWxlY3QgKiBpbnRvIHIgZnJvbSBwdWJsaWMucHVibGlj
YXRpb25fYWdlbnRfdjJfcnVucyB3aGVyZSBpZD1wX3J1bl9pZCBmb3IgdXBkYXRlOwogaWYgci5p
ZCBpcyBudWxsIHRoZW4gcmFpc2UgZXhjZXB0aW9uICdBZ2VudCBydW4gbm90IGZvdW5kJyB1c2lu
ZyBlcnJjb2RlPScyMjAyMyc7IGVuZCBpZjsKIGlmIHIuc3RhdHVzPD4ncHJvY2Vzc2luZycgb3Ig
ci5lZGl0b3JpYWxfanVzdGlmaWNhdGlvbiBpcyBub3QgbnVsbCB0aGVuCiAgcmFpc2UgZXhjZXB0
aW9uICdFZGl0b3JpYWwganVzdGlmaWNhdGlvbiBpcyBpbW11dGFibGUnIHVzaW5nIGVycmNvZGU9
JzU1MDAwJzsgZW5kIGlmOwogdXBkYXRlIHB1YmxpYy5wdWJsaWNhdGlvbl9hZ2VudF92Ml9ydW5z
IHNldCBlZGl0b3JpYWxfanVzdGlmaWNhdGlvbj1wX2p1c3RpZmljYXRpb24gd2hlcmUgaWQ9ci5p
ZDsKIHJldHVybiBqc29uYl9idWlsZF9vYmplY3QoJ3J1bl9pZCcsci5pZCwncmVjb3JkZWQnLHRy
dWUpOwplbmQgJCQ7CgotLSAzLiBEcm9pdHMgOiBzZXJ2aWNlX3JvbGUgdW5pcXVlbWVudC4KcmV2
b2tlIGFsbCBvbiBmdW5jdGlvbiBwdWJsaWNhdGlvbnNfcHJpdmF0ZS5ndWFyZF9hZ2VudF92Ml9q
dXN0aWZpY2F0aW9uKCkgZnJvbSBwdWJsaWMsYW5vbixhdXRoZW50aWNhdGVkLHNlcnZpY2Vfcm9s
ZTsKZ3JhbnQgZXhlY3V0ZSBvbiBmdW5jdGlvbiBwdWJsaWNhdGlvbnNfcHJpdmF0ZS5ndWFyZF9h
Z2VudF92Ml9qdXN0aWZpY2F0aW9uKCkgdG8gc2VydmljZV9yb2xlOwpyZXZva2UgYWxsIG9uIGZ1
bmN0aW9uIHB1YmxpYy5wdWJsaWNhdGlvbl9lZGl0b3JpYWxfanVzdGlmaWNhdGlvbl9yZWNvcmQo
dXVpZCxqc29uYix0ZXh0KSBmcm9tIHB1YmxpYyxhbm9uLGF1dGhlbnRpY2F0ZWQ7CmdyYW50IGV4
ZWN1dGUgb24gZnVuY3Rpb24gcHVibGljLnB1YmxpY2F0aW9uX2VkaXRvcmlhbF9qdXN0aWZpY2F0
aW9uX3JlY29yZCh1dWlkLGpzb25iLHRleHQpIHRvIHNlcnZpY2Vfcm9sZTsKbm90aWZ5IHBncnN0
LCAncmVsb2FkIHNjaGVtYSc7Cg==
', 'base64'), 'UTF8');
begin
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_editorial_intelligence' or name ~ '^[0-9]{14}_publications_editorial_intelligence$')) then
  raise exception 'ARRET : la migration 20261102000000 est déjà inscrite dans l''historique'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'))='596be343a7d3aead14093798b1d55f41',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_editorial_justification_record(uuid,jsonb,text)'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_editorial_justification_record(uuid,jsonb,text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('publications_private.guard_agent_v2_justification()'))='0f2748ec99a6b68dc948145291b915ad',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.guard_agent_v2_justification() : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('publications_private.guard_agent_v2_justification()')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.guard_agent_v2_justification() : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('publications_private.guard_agent_v2_justification()'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.guard_agent_v2_justification() : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.publication_agent_v2_runs') and a.attname='editorial_justification' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='jsonb' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'colonne public.publication_agent_v2_runs.editorial_justification : jsonb'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_agent_v2_runs_publications') and indrelid=to_regclass('public.publication_agent_v2_runs') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.publication_agent_v2_runs_publications sur public.publication_agent_v2_runs : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.publication_agent_v2_runs') and conname='publication_agent_v2_runs_justification_shape' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte publication_agent_v2_runs_justification_shape sur public.publication_agent_v2_runs : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_agent_v2_runs') and tgname='agent_v2_run_justification_guard' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.guard_agent_v2_justification()'))) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'déclencheur agent_v2_run_justification_guard sur public.publication_agent_v2_runs : présent, actif, appelle publications_private.guard_agent_v2_justification()'; end if;
 if not (not exists(select 1 from public.publication_agent_v2_runs where editorial_justification is not null)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'justification éditoriale : colonne nullable, aucune ligne existante renseignée'; end if;
 if md5(migration_text)<>expected_md5 then
  raise exception 'ARRET : texte décodé inattendu (md5 %, % octets)', md5(migration_text), octet_length(migration_text); end if;
 insert into supabase_migrations.schema_migrations(version, name, statements)
 values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'publications_editorial_intelligence', array[migration_text]);
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name='publications_editorial_intelligence')<>expected_md5 then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
 raise notice 'Migration 20261102000000 inscrite dans l''historique.';
end $sync$;
commit;

select version, name, md5(statements[1]) as md5_texte, octet_length(statements[1]) as octets
  from supabase_migrations.schema_migrations order by version desc limit 3;
