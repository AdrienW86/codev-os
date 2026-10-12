-- =========================================================================================================
-- PR #41 : inscription de 20261101000000_whatsapp_export_import.sql dans l'historique Supabase
-- À exécuter APRÈS une application réussie de apply_sql_editor.sql, dans une nouvelle requête du SQL Editor.
-- Convention de l'historique de ce projet : version = horodatage UTC de l'inscription, nom court (whatsapp_export_import), texte dans statements.
-- Refuse d'écrire si la migration n'est pas réellement en place (mêmes contrôles qu'après application) ou si elle est
-- déjà inscrite. Le texte inscrit est le fichier du dépôt, transporté en base64 : un copier-coller qui change les fins
-- de ligne (CRLF sous Windows) ou l'encodage ne peut pas l'altérer. Les corps de fonctions en base sont comparés à
-- ceux du dépôt en ignorant seulement les fins de ligne. Une seule transaction : en cas d'anomalie, rien n'est écrit.
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261101000000_whatsapp_export_import.sql (md5 2070fedbbc2cfd339544e330a0540411, 5531 octets).
-- =========================================================================================================
begin;
do $sync$
declare
 expected_md5 constant text := '2070fedbbc2cfd339544e330a0540411';
 migration_text text := convert_from(decode('
LS0gU29jbGUgUHVibGljYXRpb25zLCBsb3QgMyA6IGltcG9ydCBkJ3VuIGV4cG9ydCBkZSBkaXNj
dXNzaW9uIFdoYXRzQXBwIGRlcHVpcyBsYSBmaWNoZSBjbGllbnQuCi0tIETDqXBlbmQgZGUgMjAy
NjEwMjgwMDAwMDBfbWVkaWFfbGlicmFyeV9pbnRlbGxpZ2VuY2Uuc3FsIChvcmlnaW5lIMKrIHdo
YXRzYXBwX2V4cG9ydCDCuyBldCBkYXRlIGQnb3JpZ2luZSkuCi0tIEwnYXJjaGl2ZSAoZXQgZGVz
IGFwZXLDp3VzIHLDqWR1aXRzKSBlc3QgZMOpcG9zw6llIGRhbnMgdW4gYnVja2V0IHByaXbDqSB0
ZW1wb3JhaXJlLCBhbmFseXPDqWUgcGFyIGxvdHMsIHB1aXMgc3VwcHJpbcOpZS4gTGEgY29udmVy
c2F0aW9uIG4nZXN0Ci0tIGphbWFpcyBzdG9ja8OpZSA6IHNldWxlcyBsZXMgcGnDqGNlcyBqb2lu
dGVzIGltYWdlcyByZXRlbnVlcywgbGV1ciBkYXRlIGV0IGxldXIgbMOpZ2VuZGUgc29udCBjb25z
ZXJ2w6llcy4KLS0gRm9yd2FyZC1vbmx5LiBSTFMgYWN0aXZlIHNhbnMgcG9saXRpcXVlIDogdW5p
cXVlbWVudCBsZSBzZXJ2ZXVyIChzZXJ2aWNlX3JvbGUpLgoKaW5zZXJ0IGludG8gc3RvcmFnZS5i
dWNrZXRzIChpZCwgbmFtZSwgcHVibGljLCBmaWxlX3NpemVfbGltaXQsIGFsbG93ZWRfbWltZV90
eXBlcykKdmFsdWVzICgnd2hhdHNhcHAtZXhwb3J0cycsICd3aGF0c2FwcC1leHBvcnRzJywgZmFs
c2UsIDUyNDI4ODAwMCwgYXJyYXlbJ2FwcGxpY2F0aW9uL3ppcCcsJ2FwcGxpY2F0aW9uL3gtemlw
LWNvbXByZXNzZWQnLCdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLCdpbWFnZS93ZWJwJ10pOwoK
Y3JlYXRlIHRhYmxlIHB1YmxpYy53aGF0c2FwcF9leHBvcnRfaW1wb3J0cyAoCiAgaWQgdXVpZCBw
cmltYXJ5IGtleSBkZWZhdWx0IGdlbl9yYW5kb21fdXVpZCgpLAogIGNsaWVudF9pZCB1dWlkIG5v
dCBudWxsIHJlZmVyZW5jZXMgcHVibGljLmNsaWVudHMoaWQpIG9uIGRlbGV0ZSByZXN0cmljdCwK
ICBkcml2ZV9mb2xkZXJfaWQgdGV4dCBub3QgbnVsbCBjaGVjayAoZHJpdmVfZm9sZGVyX2lkIH4g
J15bYS16QS1aMC05Xy1dezEwLDIwMH0kJyksCiAgc3RhdHVzIHRleHQgbm90IG51bGwgZGVmYXVs
dCAndXBsb2FkaW5nJyBjaGVjayAoc3RhdHVzIGluICgndXBsb2FkaW5nJywnYW5hbHl6aW5nJywn
cmVhZHknLCdpbXBvcnRpbmcnLCdjb21wbGV0ZWQnLCdjYW5jZWxsZWQnLCdleHBpcmVkJywnZmFp
bGVkJykpLAogIHN0b3JhZ2VfcGF0aCB0ZXh0IG5vdCBudWxsIGNoZWNrIChzdG9yYWdlX3BhdGgg
fiAnXlswLTlhLWYtXXszNn0vWzAtOWEtZi1dezM2fVwuemlwJCcpLAogIGFyY2hpdmVfc2l6ZSBi
aWdpbnQgY2hlY2sgKGFyY2hpdmVfc2l6ZSBpcyBudWxsIG9yIGFyY2hpdmVfc2l6ZSBiZXR3ZWVu
IDEgYW5kIDUyNDI4ODAwMCksCiAgLS0gQ29tcHRldXJzIGQnYW5hbHlzZSBldCBkJ2ltcG9ydCAo
amFtYWlzIGRlIHRleHRlIGRlIGNvbnZlcnNhdGlvbikuCiAgY291bnRzIGpzb25iIG5vdCBudWxs
IGRlZmF1bHQgJ3t9JyBjaGVjayAoanNvbmJfdHlwZW9mKGNvdW50cykgPSAnb2JqZWN0JyksCiAg
aW5jb21wbGV0ZSBib29sZWFuIG5vdCBudWxsIGRlZmF1bHQgZmFsc2UsCiAgZXJyb3JfY29kZSB0
ZXh0IGNoZWNrIChlcnJvcl9jb2RlIGlzIG51bGwgb3IgZXJyb3JfY29kZSB+ICdeW2EtejAtOV9d
ezEsNjB9JCcpLAogIHJpZ2h0c19jb25maXJtZWQgYm9vbGVhbiBub3QgbnVsbCBjaGVjayAocmln
aHRzX2NvbmZpcm1lZCksCiAgY3JlYXRlZF9ieSB0ZXh0IG5vdCBudWxsIGNoZWNrIChjcmVhdGVk
X2J5IH4gJ151c2VyX1thLXpBLVowLTlfLV17MSwyMDB9JCcpLAogIGNyZWF0ZWRfYXQgdGltZXN0
YW1wdHogbm90IG51bGwgZGVmYXVsdCBub3coKSwKICB1cGRhdGVkX2F0IHRpbWVzdGFtcHR6IG5v
dCBudWxsIGRlZmF1bHQgbm93KCksCiAgZXhwaXJlc19hdCB0aW1lc3RhbXB0eiBub3QgbnVsbCBk
ZWZhdWx0IG5vdygpICsgaW50ZXJ2YWwgJzI0IGhvdXJzJywKICBwdXJnZWRfYXQgdGltZXN0YW1w
dHosCiAgdW5pcXVlIChpZCwgY2xpZW50X2lkKSwKICBjb25zdHJhaW50IHdoYXRzYXBwX2V4cG9y
dF9pbXBvcnRzX3BhdGhfc2NvcGUgY2hlY2sgKHN0b3JhZ2VfcGF0aCA9IGNsaWVudF9pZDo6dGV4
dCB8fCAnLycgfHwgaWQ6OnRleHQgfHwgJy56aXAnKQopOwpjcmVhdGUgaW5kZXggd2hhdHNhcHBf
ZXhwb3J0X2ltcG9ydHNfY2xpZW50IG9uIHB1YmxpYy53aGF0c2FwcF9leHBvcnRfaW1wb3J0cyAo
Y2xpZW50X2lkLCBjcmVhdGVkX2F0IGRlc2MpOwpjcmVhdGUgaW5kZXggd2hhdHNhcHBfZXhwb3J0
X2ltcG9ydHNfcHVyZ2Ugb24gcHVibGljLndoYXRzYXBwX2V4cG9ydF9pbXBvcnRzIChleHBpcmVz
X2F0KSB3aGVyZSBwdXJnZWRfYXQgaXMgbnVsbDsKLS0gVW4gc2V1bCBpbXBvcnQgYWN0aWYgcGFy
IGNsaWVudCwgbcOqbWUgYXZlYyBkZXV4IGTDqW1hcnJhZ2VzIHNpbXVsdGFuw6lzIChsZSBzZWNv
bmQgcmXDp29pdCB1bmUgdmlvbGF0aW9uIGQndW5pY2l0w6kpLgpjcmVhdGUgdW5pcXVlIGluZGV4
IHdoYXRzYXBwX2V4cG9ydF9pbXBvcnRzX29uZV9hY3RpdmUgb24gcHVibGljLndoYXRzYXBwX2V4
cG9ydF9pbXBvcnRzIChjbGllbnRfaWQpIHdoZXJlIHN0YXR1cyBpbiAoJ3VwbG9hZGluZycsJ2Fu
YWx5emluZycsJ3JlYWR5JywnaW1wb3J0aW5nJyk7CgpjcmVhdGUgdGFibGUgcHVibGljLndoYXRz
YXBwX2V4cG9ydF9pdGVtcyAoCiAgaWQgdXVpZCBwcmltYXJ5IGtleSBkZWZhdWx0IGdlbl9yYW5k
b21fdXVpZCgpLAogIGltcG9ydF9pZCB1dWlkIG5vdCBudWxsLAogIGNsaWVudF9pZCB1dWlkIG5v
dCBudWxsLAogIGVudHJ5X25hbWUgdGV4dCBub3QgbnVsbCBjaGVjayAobGVuZ3RoKGVudHJ5X25h
bWUpIGJldHdlZW4gMSBhbmQgMzAwIGFuZCBlbnRyeV9uYW1lICF+ICdbXHgwMC1ceDFmXScpLAog
IGVudHJ5X29mZnNldCBiaWdpbnQgbm90IG51bGwgY2hlY2sgKGVudHJ5X29mZnNldCA+PSAwKSwK
ICBjb21wcmVzc2VkX3NpemUgYmlnaW50IG5vdCBudWxsIGNoZWNrIChjb21wcmVzc2VkX3NpemUg
Pj0gMCksCiAgc2l6ZSBiaWdpbnQgbm90IG51bGwgY2hlY2sgKHNpemUgPj0gMCksCiAgbWV0aG9k
IHNtYWxsaW50IG5vdCBudWxsIGNoZWNrIChtZXRob2QgaW4gKDAsIDgpKSwKICBjcmMzMiBiaWdp
bnQgbm90IG51bGwgY2hlY2sgKGNyYzMyIGJldHdlZW4gMCBhbmQgNDI5NDk2NzI5NSksCiAgY2Fw
dHVyZWRfYXQgdGltZXN0YW1wdHosCiAgLS0gTMOpZ2VuZGUgZHUgbWVzc2FnZSBkZSBsYSBwaG90
byB1bmlxdWVtZW50IDsgZWZmYWPDqWUgcXVhbmQgbCdpbXBvcnQgZXN0IHRlcm1pbsOpLCBhbm51
bMOpIG91IGV4cGlyw6kuCiAgY2FwdGlvbiB0ZXh0IGNoZWNrIChjYXB0aW9uIGlzIG51bGwgb3Ig
bGVuZ3RoKGNhcHRpb24pIDw9IDMwMDApLAogIC0tIMKrIGltcG9ydGluZyDCuyA6IHBob3RvIHLD
qXNlcnbDqWUgcGFyIHVuIGxvdCBkJ2ltcG9ydCAoY29tcGFyZS1hbmQtc2V0KSwgZGV1eCBvbmds
ZXRzIG5lIGxhIHRyYWl0ZW50IGphbWFpcyBlbiBtw6ptZSB0ZW1wcy4KICBzdGF0dXMgdGV4dCBu
b3QgbnVsbCBkZWZhdWx0ICdwZW5kaW5nJyBjaGVjayAoc3RhdHVzIGluICgncGVuZGluZycsJ3Jl
YWR5JywnaW1wb3J0aW5nJywnZHVwbGljYXRlJywnaW52YWxpZCcsJ3Rvb19sYXJnZScsJ2ltcG9y
dGVkJywnZmFpbGVkJykpLAogIHNlbGVjdGVkIGJvb2xlYW4gbm90IG51bGwgZGVmYXVsdCB0cnVl
LAogIHNoYTI1NiB0ZXh0IGNoZWNrIChzaGEyNTYgaXMgbnVsbCBvciBzaGEyNTYgfiAnXlswLTlh
LWZdezY0fSQnKSwKICBtZDUgdGV4dCBjaGVjayAobWQ1IGlzIG51bGwgb3IgbWQ1IH4gJ15bMC05
YS1mXXszMn0kJyksCiAgbWltZV90eXBlIHRleHQgY2hlY2sgKG1pbWVfdHlwZSBpcyBudWxsIG9y
IG1pbWVfdHlwZSBpbiAoJ2ltYWdlL2pwZWcnLCdpbWFnZS9wbmcnLCdpbWFnZS93ZWJwJykpLAog
IHdpZHRoIGludGVnZXIgY2hlY2sgKHdpZHRoIGlzIG51bGwgb3Igd2lkdGggPiAwKSwKICBoZWln
aHQgaW50ZWdlciBjaGVjayAoaGVpZ2h0IGlzIG51bGwgb3IgaGVpZ2h0ID4gMCksCiAgcHJldmll
d19wYXRoIHRleHQgY2hlY2sgKHByZXZpZXdfcGF0aCBpcyBudWxsIG9yIHByZXZpZXdfcGF0aCB+
ICdeWzAtOWEtZi1dezM2fS9bMC05YS1mLV17MzZ9L1swLTlhLWYtXXszNn1cLndlYnAkJyksCiAg
YXNzZXRfaWQgdXVpZCwKICBlcnJvcl9jb2RlIHRleHQgY2hlY2sgKGVycm9yX2NvZGUgaXMgbnVs
bCBvciBlcnJvcl9jb2RlIH4gJ15bYS16MC05X117MSw2MH0kJyksCiAgY3JlYXRlZF9hdCB0aW1l
c3RhbXB0eiBub3QgbnVsbCBkZWZhdWx0IG5vdygpLAogIHVwZGF0ZWRfYXQgdGltZXN0YW1wdHog
bm90IG51bGwgZGVmYXVsdCBub3coKSwKICBmb3JlaWduIGtleSAoaW1wb3J0X2lkLCBjbGllbnRf
aWQpIHJlZmVyZW5jZXMgcHVibGljLndoYXRzYXBwX2V4cG9ydF9pbXBvcnRzKGlkLCBjbGllbnRf
aWQpIG9uIGRlbGV0ZSBjYXNjYWRlLAogIGZvcmVpZ24ga2V5IChhc3NldF9pZCwgY2xpZW50X2lk
KSByZWZlcmVuY2VzIHB1YmxpYy53aGF0c2FwcF9hc3NldHMoaWQsIGNsaWVudF9pZCkgb24gZGVs
ZXRlIHJlc3RyaWN0LAogIHVuaXF1ZSAoaW1wb3J0X2lkLCBlbnRyeV9uYW1lKQopOwpjcmVhdGUg
aW5kZXggd2hhdHNhcHBfZXhwb3J0X2l0ZW1zX3dvcmsgb24gcHVibGljLndoYXRzYXBwX2V4cG9y
dF9pdGVtcyAoaW1wb3J0X2lkLCBzdGF0dXMpIHdoZXJlIHN0YXR1cyBpbiAoJ3BlbmRpbmcnLCdy
ZWFkeScsJ2ltcG9ydGluZycpOwoKY3JlYXRlIHRyaWdnZXIgd2hhdHNhcHBfZXhwb3J0X2ltcG9y
dHNfdXBkYXRlZCBiZWZvcmUgdXBkYXRlIG9uIHB1YmxpYy53aGF0c2FwcF9leHBvcnRfaW1wb3J0
cyBmb3IgZWFjaCByb3cgZXhlY3V0ZSBmdW5jdGlvbiBwdWJsaWNhdGlvbnNfcHJpdmF0ZS50b3Vj
aF91cGRhdGVkX2F0KCk7CmNyZWF0ZSB0cmlnZ2VyIHdoYXRzYXBwX2V4cG9ydF9pdGVtc191cGRh
dGVkIGJlZm9yZSB1cGRhdGUgb24gcHVibGljLndoYXRzYXBwX2V4cG9ydF9pdGVtcyBmb3IgZWFj
aCByb3cgZXhlY3V0ZSBmdW5jdGlvbiBwdWJsaWNhdGlvbnNfcHJpdmF0ZS50b3VjaF91cGRhdGVk
X2F0KCk7CgphbHRlciB0YWJsZSBwdWJsaWMud2hhdHNhcHBfZXhwb3J0X2ltcG9ydHMgZW5hYmxl
IHJvdyBsZXZlbCBzZWN1cml0eTsKYWx0ZXIgdGFibGUgcHVibGljLndoYXRzYXBwX2V4cG9ydF9p
dGVtcyBlbmFibGUgcm93IGxldmVsIHNlY3VyaXR5OwpyZXZva2UgYWxsIG9uIHB1YmxpYy53aGF0
c2FwcF9leHBvcnRfaW1wb3J0cywgcHVibGljLndoYXRzYXBwX2V4cG9ydF9pdGVtcyBmcm9tIHB1
YmxpYywgYW5vbiwgYXV0aGVudGljYXRlZDsKZ3JhbnQgc2VsZWN0LCBpbnNlcnQsIHVwZGF0ZSBv
biBwdWJsaWMud2hhdHNhcHBfZXhwb3J0X2ltcG9ydHMsIHB1YmxpYy53aGF0c2FwcF9leHBvcnRf
aXRlbXMgdG8gc2VydmljZV9yb2xlOwpncmFudCBkZWxldGUgb24gcHVibGljLndoYXRzYXBwX2V4
cG9ydF9pdGVtcyB0byBzZXJ2aWNlX3JvbGU7Cm5vdGlmeSBwZ3JzdCwgJ3JlbG9hZCBzY2hlbWEn
Owo=
', 'base64'), 'UTF8');
begin
 if exists(select 1 from supabase_migrations.schema_migrations where (name='whatsapp_export_import' or name ~ '^[0-9]{14}_whatsapp_export_import$')) then
  raise exception 'ARRET : la migration 20261101000000 est déjà inscrite dans l''historique'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_export_imports')),false)=true) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.whatsapp_export_imports : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_export_imports'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_imports'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_imports'),'DELETE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.whatsapp_export_imports : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE,DELETE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.whatsapp_export_items')),false)=true) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.whatsapp_export_items : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'SELECT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'INSERT') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'UPDATE') or has_table_privilege('anon',to_regclass('public.whatsapp_export_items'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.whatsapp_export_items'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.whatsapp_export_items'),'DELETE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.whatsapp_export_items : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE,DELETE'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_client') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.whatsapp_export_imports_client sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_one_active') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=true)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.whatsapp_export_imports_one_active sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_imports_purge') and indrelid=to_regclass('public.whatsapp_export_imports') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.whatsapp_export_imports_purge sur public.whatsapp_export_imports : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.whatsapp_export_items_work') and indrelid=to_regclass('public.whatsapp_export_items') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.whatsapp_export_items_work sur public.whatsapp_export_items : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.whatsapp_export_imports') and conname='whatsapp_export_imports_path_scope' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte whatsapp_export_imports_path_scope sur public.whatsapp_export_imports : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_imports') and tgname='whatsapp_export_imports_updated' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.touch_updated_at()'))) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'déclencheur whatsapp_export_imports_updated sur public.whatsapp_export_imports : présent, actif, appelle publications_private.touch_updated_at()'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.whatsapp_export_items') and tgname='whatsapp_export_items_updated' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.touch_updated_at()'))) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'déclencheur whatsapp_export_items_updated sur public.whatsapp_export_items : présent, actif, appelle publications_private.touch_updated_at()'; end if;
 if not (exists(select 1 from storage.buckets where id='whatsapp-exports' and public=false and coalesce(file_size_limit::text,'')='524288000' and coalesce(allowed_mime_types::text,'')='{application/zip,application/x-zip-compressed,application/octet-stream,image/webp}')) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'bucket whatsapp-exports : privé, 524288000 octets maximum, types {application/zip,application/x-zip-compressed,application/octet-stream,image/webp}'; end if;
 if not (not exists(select 1 from pg_policies where schemaname='storage' and (coalesce(qual,'')||coalesce(with_check,'')) like '%whatsapp-exports%')) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'stockage : aucune politique sur storage.objects ne mentionne le bucket whatsapp-exports (accès serveur uniquement)'; end if;
 if md5(migration_text)<>expected_md5 then
  raise exception 'ARRET : texte décodé inattendu (md5 %, % octets)', md5(migration_text), octet_length(migration_text); end if;
 insert into supabase_migrations.schema_migrations(version, name, statements)
 values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'whatsapp_export_import', array[migration_text]);
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name='whatsapp_export_import')<>expected_md5 then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
 raise notice 'Migration 20261101000000 inscrite dans l''historique.';
end $sync$;
commit;

select version, name, md5(statements[1]) as md5_texte, octet_length(statements[1]) as octets
  from supabase_migrations.schema_migrations order by version desc limit 3;
