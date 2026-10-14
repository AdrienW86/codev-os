-- =========================================================================================================
-- PR #47 : inscription de 20261106000000_publications_robustness.sql dans l'historique Supabase
-- À exécuter APRÈS une application réussie de apply_sql_editor.sql, dans une nouvelle requête du SQL Editor.
-- Convention de l'historique de ce projet : version = horodatage UTC de l'inscription, nom court (publications_robustness), texte dans statements.
-- Refuse d'écrire si la migration n'est pas réellement en place (mêmes contrôles qu'après application) ou si elle est
-- déjà inscrite. Le texte inscrit est le fichier du dépôt, transporté en base64 : un copier-coller qui change les fins
-- de ligne (CRLF sous Windows) ou l'encodage ne peut pas l'altérer. Les corps de fonctions en base sont comparés à
-- ceux du dépôt en ignorant seulement les fins de ligne. Une seule transaction : en cas d'anomalie, rien n'est écrit.
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261106000000_publications_robustness.sql (md5 0f4662e0a13d46cc9580728b2e71dc71, 4461 octets).
-- =========================================================================================================
begin;
do $sync$
declare
 expected_md5 constant text := '0f4662e0a13d46cc9580728b2e71dc71';
 migration_text text := convert_from(decode('
LS0gU29jbGUgUHVibGljYXRpb25zLCBwaGFzZSA4ICgjNDcpIDogcm9idXN0ZXNzZSBldCBjaGFy
Z2UgZHUgcGlwZWxpbmUgcGxhbmlmacOpLiBSaWVuIG4nZXN0IGFjdGl2w6kgOiBsYSBkaWZmdXNp
b24KLS0gcGxhbmlmacOpZSByZXN0ZSBzb3VzIHNvbiBkcmFwZWF1IGQnZW52aXJvbm5lbWVudCAo
ZMOpc2FjdGl2w6kgcGFyIGTDqWZhdXQpIGV0IHNvdXMgbGVzIGludGVycnVwdGV1cnMgZW4gYmFz
ZS4KLS0gQXVjdW5lIGxpZ25lIGV4aXN0YW50ZSBtb2RpZmnDqWUsIGF1Y3VuZSB0YWJsZSBjcsOp
w6llLgoKLS0gMS4gR2FyZGUgZGUgcmV0YXJkICgyIGgpIGFwcGxpcXXDqWUgYXVzc2kgYXV4IHLD
qWVzc2FpcyBhdXRvbWF0aXF1ZXMuIEF2YW50IDogbGUgcmV0YXJkIHNlIG1lc3VyYWl0IHN1ciBy
dW5fYXQsIHF1ZQotLSBwdWJsaWNhdGlvbl9qb2JfY29tcGxldGUgcmVwb3Vzc2Ugw6AgY2hhcXVl
IHLDqWVzc2FpICgxIG1pbiDigKYgNiBoLCBvdSBkw6lsYWkgaW1wb3PDqSBwYXIgbGUgZm91cm5p
c3NldXIpIDogdW4gZW52b2kgZMO7IMOgCi0tIDkgaCwgZW4gw6ljaGVjIHRlbXBvcmFpcmUsIHBv
dXZhaXQgcGFydGlyIMOgIDExIGggMzAgc2FucyBhdWN1biBodW1haW4uIETDqXNvcm1haXMgbGEg
csOpZsOpcmVuY2UgZXN0IGwnaGV1cmUgZHVlIGRlIGxhCi0tIGRpZmZ1c2lvbiAoc2NoZWR1bGVk
X2ZvciksIG91IGxhIGRlcm5pw6hyZSByZWxhbmNlIHBhciB1biBodW1haW4gKHB1YmxpY2F0aW9u
LmRlbGl2ZXJ5X3JldHJpZWQpIHNpIGVsbGUgZXN0IHBsdXMgcsOpY2VudGUgOgotLSB1bmUgdMOi
Y2hlIGRvbnQgbGEgcsOpZsOpcmVuY2UgZMOpcGFzc2UgbGEgdG9sw6lyYW5jZSBlc3QgYmxvcXXD
qWUgKGxhdGVfc2NoZWR1bGUsIG5vdGlmacOpZSwgcmVsYW7Dp2FibGUgZGVwdWlzIGxhIGZpY2hl
KS4KLS0gTGUgcmVzdGUgZXN0IGluY2hhbmfDqSAodmVycm91IFNLSVAgTE9DS0VELCA1MCBibG9j
YWdlcyBhdSBwbHVzIHBhciBhcHBlbCwgcHVpcyBwdWJsaWNhdGlvbl9qb2JfY2xhaW0gdGVsbGUg
cXVlbGxlKS4KY3JlYXRlIG9yIHJlcGxhY2UgZnVuY3Rpb24gcHVibGljLnB1YmxpY2F0aW9uX2pv
Yl9jbGFpbV9vbl90aW1lKHBfd29ya2VyX2lkIHRleHQscF9sZWFzZV9zZWNvbmRzIGludGVnZXIs
cF9tYXhfbGF0ZV9zZWNvbmRzIGludGVnZXIpIHJldHVybnMganNvbmIKbGFuZ3VhZ2UgcGxwZ3Nx
bCBzZWN1cml0eSBpbnZva2VyIHNldCBzZWFyY2hfcGF0aD1wZ19jYXRhbG9nIGFzICQkCmRlY2xh
cmUgaiByZWNvcmQ7biBpbnRlZ2VyOj0wO2xhdGUgdGltZXN0YW1wdHo7CmJlZ2luCiBpZiBwX21h
eF9sYXRlX3NlY29uZHMgaXMgbnVsbCBvciBwX21heF9sYXRlX3NlY29uZHMgbm90IGJldHdlZW4g
NjAgYW5kIDg2NDAwIHRoZW4gcmFpc2UgZXhjZXB0aW9uICdJbnZhbGlkIGNsYWltJyB1c2luZyBl
cnJjb2RlPScyMjAyMyc7IGVuZCBpZjsKIGlmIGNvYWxlc2NlKChzZWxlY3QgZW1lcmdlbmN5X3N0
b3AgZnJvbSBwdWJsaWMucHVibGljYXRpb25fc2V0dGluZ3MgbGltaXQgMSksdHJ1ZSkgdGhlbiBy
ZXR1cm4gbnVsbDsgZW5kIGlmOwogbGF0ZTo9bm93KCktbWFrZV9pbnRlcnZhbChzZWNzPT5wX21h
eF9sYXRlX3NlY29uZHMpOwogZm9yIGogaW4gc2VsZWN0IHBqLmRlbGl2ZXJ5X2lkIGZyb20gcHVi
bGljLnB1YmxpY2F0aW9uX2pvYnMgcGogam9pbiBwdWJsaWMucHVibGljYXRpb25fZGVsaXZlcmll
cyBkIG9uIGQuaWQ9cGouZGVsaXZlcnlfaWQKICAgd2hlcmUgcGoudHlwZT0nZGVsaXZlcicgYW5k
IHBqLmRpc3BhdGNoZWRfYXQgaXMgbnVsbAogICAgYW5kIChwai5zdGF0dXM9J3BlbmRpbmcnIG9y
IChwai5zdGF0dXM9J3Byb2Nlc3NpbmcnIGFuZCBwai5sZWFzZV9leHBpcmVzX2F0PD1ub3coKSkp
CiAgICBhbmQgZC5zdGF0dXMgaW4oJ3NjaGVkdWxlZCcsJ3JldHJ5YWJsZV9lcnJvcicsJ3Byb2Nl
c3NpbmcnKSBhbmQgZC5yZXZpc2lvbl9pZCBpcyBub3QgbnVsbAogICAgYW5kIChwai5ydW5fYXQ8
bGF0ZSBvciBncmVhdGVzdChkLnNjaGVkdWxlZF9mb3IsKHNlbGVjdCBtYXgoZS5jcmVhdGVkX2F0
KSBmcm9tIHB1YmxpYy5wdWJsaWNhdGlvbl9ldmVudHMgZQogICAgICB3aGVyZSBlLnJlc291cmNl
X3R5cGU9J3B1YmxpY2F0aW9uJyBhbmQgZS5yZXNvdXJjZV9pZD1kLnB1YmxpY2F0aW9uX2lkIGFu
ZCBlLmFjdGlvbj0ncHVibGljYXRpb24uZGVsaXZlcnlfcmV0cmllZCcKICAgICAgIGFuZCBlLm1l
dGFkYXRhLT4+J2RlbGl2ZXJ5X2lkJz1kLmlkOjp0ZXh0KSk8bGF0ZSkKICAgb3JkZXIgYnkgcGou
cnVuX2F0LHBqLmlkIGxpbWl0IDUwIGZvciB1cGRhdGUgb2YgcGogc2tpcCBsb2NrZWQgbG9vcAog
IHBlcmZvcm0gcHVibGljYXRpb25zX3ByaXZhdGUuYmxvY2tfZGVsaXZlcnkoai5kZWxpdmVyeV9p
ZCwnbGF0ZV9zY2hlZHVsZScpO246PW4rMTsKIGVuZCBsb29wOwogLS0gRW5jb3JlIGRlcyByZXRh
cmRzIMOgIGJsb3F1ZXIgOiByaWVuIG4nZXN0IGVudm95w6kgZGFucyBjZSBwYXNzYWdlIChsZSBz
dWl2YW50IGNvbnRpbnVlKS4KIGlmIG49NTAgdGhlbiByZXR1cm4gbnVsbDsgZW5kIGlmOwogcmV0
dXJuIHB1YmxpYy5wdWJsaWNhdGlvbl9qb2JfY2xhaW0ocF93b3JrZXJfaWQscF9sZWFzZV9zZWNv
bmRzKTsKZW5kICQkOwoKLS0gMi4gUsOpc2VydmF0aW9uIGR1IHBsYW5pZmljYXRldXIgbGltaXTD
qWUgYXV4IHBsYXRlZm9ybWVzIGRvbnQgbCdlbnZvaSB0aWVudCBkYW5zIGxlIHRlbXBzIHJlc3Rh
bnQgZHUgcGFzc2FnZS4KLS0gcF9wbGF0Zm9ybXMgbnVsIDogY29tcG9ydGVtZW50IGRlIHB1Ymxp
Y2F0aW9uX2pvYl9jbGFpbV9vbl90aW1lLiBTaW5vbiwgbGEgcsOpc2VydmF0aW9uIG9yZGluYWly
ZSAobcOqbWUgb3JkcmUsIG3Dqm1lcwotLSBjb250csO0bGVzKSBlc3QgZmFpdGUgZGFucyB1bmUg
c291cy10cmFuc2FjdGlvbiA7IHNpIGxhIHTDomNoZSByw6lzZXJ2w6llIGVzdCBkJ3VuZSBhdXRy
ZSBwbGF0ZWZvcm1lLCB0b3V0IGVzdCBhbm51bMOpIGV0Ci0tIHJpZW4gbidlc3QgcsOpc2VydsOp
IDogbGEgdMOiY2hlIHJlc3RlIGVuIHTDqnRlIGRlIGZpbGUgcG91ciBsZSBwYXNzYWdlIHN1aXZh
bnQgKGphbWFpcyBkb3VibMOpZSBwYXIgdW5lIHBsdXMgcmFwaWRlKS4KY3JlYXRlIGZ1bmN0aW9u
IHB1YmxpYy5wdWJsaWNhdGlvbl9qb2JfY2xhaW1fc2NoZWR1bGVkKHBfd29ya2VyX2lkIHRleHQs
cF9sZWFzZV9zZWNvbmRzIGludGVnZXIscF9tYXhfbGF0ZV9zZWNvbmRzIGludGVnZXIscF9wbGF0
Zm9ybXMgdGV4dFtdKSByZXR1cm5zIGpzb25iCmxhbmd1YWdlIHBscGdzcWwgc2VjdXJpdHkgaW52
b2tlciBzZXQgc2VhcmNoX3BhdGg9cGdfY2F0YWxvZyBhcyAkJApkZWNsYXJlIGMganNvbmI7CmJl
Z2luCiBpZiBwX3BsYXRmb3JtcyBpcyBub3QgbnVsbCBhbmQgKGNhcmRpbmFsaXR5KHBfcGxhdGZv
cm1zKSBub3QgYmV0d2VlbiAxIGFuZCAzIG9yIGV4aXN0cyhzZWxlY3QgMSBmcm9tIHVubmVzdChw
X3BsYXRmb3JtcykgeAogICB3aGVyZSB4IGlzIG51bGwgb3IgeCBub3QgaW4oJ2ZhY2Vib29rJywn
aW5zdGFncmFtJywnZ29vZ2xlX2J1c2luZXNzX3Byb2ZpbGUnKSkpIHRoZW4gcmFpc2UgZXhjZXB0
aW9uICdJbnZhbGlkIGNsYWltJyB1c2luZyBlcnJjb2RlPScyMjAyMyc7IGVuZCBpZjsKIGlmIHBf
cGxhdGZvcm1zIGlzIG51bGwgdGhlbiByZXR1cm4gcHVibGljLnB1YmxpY2F0aW9uX2pvYl9jbGFp
bV9vbl90aW1lKHBfd29ya2VyX2lkLHBfbGVhc2Vfc2Vjb25kcyxwX21heF9sYXRlX3NlY29uZHMp
OyBlbmQgaWY7CiBiZWdpbgogIGM6PXB1YmxpYy5wdWJsaWNhdGlvbl9qb2JfY2xhaW1fb25fdGlt
ZShwX3dvcmtlcl9pZCxwX2xlYXNlX3NlY29uZHMscF9tYXhfbGF0ZV9zZWNvbmRzKTsKICBpZiBj
IGlzIG5vdCBudWxsIGFuZCBub3QgKGMtPj4ncGxhdGZvcm0nPWFueShwX3BsYXRmb3JtcykpIHRo
ZW4gcmFpc2UgZXhjZXB0aW9uICdEZWZlcnJlZCBjbGFpbScgdXNpbmcgZXJyY29kZT0nUEQwNDcn
OyBlbmQgaWY7CiAgcmV0dXJuIGM7CiBleGNlcHRpb24gd2hlbiBzcWxzdGF0ZSAnUEQwNDcnIHRo
ZW4gcmV0dXJuIG51bGw7CiBlbmQ7CmVuZCAkJDsKCnJldm9rZSBhbGwgb24gZnVuY3Rpb24gcHVi
bGljLnB1YmxpY2F0aW9uX2pvYl9jbGFpbV9vbl90aW1lKHRleHQsaW50ZWdlcixpbnRlZ2VyKSxw
dWJsaWMucHVibGljYXRpb25fam9iX2NsYWltX3NjaGVkdWxlZCh0ZXh0LGludGVnZXIsaW50ZWdl
cix0ZXh0W10pIGZyb20gcHVibGljLGFub24sYXV0aGVudGljYXRlZDsKZ3JhbnQgZXhlY3V0ZSBv
biBmdW5jdGlvbiBwdWJsaWMucHVibGljYXRpb25fam9iX2NsYWltX29uX3RpbWUodGV4dCxpbnRl
Z2VyLGludGVnZXIpLHB1YmxpYy5wdWJsaWNhdGlvbl9qb2JfY2xhaW1fc2NoZWR1bGVkKHRleHQs
aW50ZWdlcixpbnRlZ2VyLHRleHRbXSkgdG8gc2VydmljZV9yb2xlOwpub3RpZnkgcGdyc3QsICdy
ZWxvYWQgc2NoZW1hJzsK
', 'base64'), 'UTF8');
begin
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_robustness' or name ~ '^[0-9]{14}_publications_robustness$')) then
  raise exception 'ARRET : la migration 20261106000000 est déjà inscrite dans l''historique'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'))='cec5c9f4ebc579c289faa982533cc8a0',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_scheduled(text,integer,integer,text[])'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_scheduled(text,integer,integer,text[]) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'))='0a250cee5c7f837229ad8c00f8afd59b',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if md5(migration_text)<>expected_md5 then
  raise exception 'ARRET : texte décodé inattendu (md5 %, % octets)', md5(migration_text), octet_length(migration_text); end if;
 insert into supabase_migrations.schema_migrations(version, name, statements)
 values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'publications_robustness', array[migration_text]);
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name='publications_robustness')<>expected_md5 then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
 raise notice 'Migration 20261106000000 inscrite dans l''historique.';
end $sync$;
commit;

select version, name, md5(statements[1]) as md5_texte, octet_length(statements[1]) as octets
  from supabase_migrations.schema_migrations order by version desc limit 3;
