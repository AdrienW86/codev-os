-- =========================================================================================================
-- PR #39 : inscription de 20261030000000_publications_scheduled_flow.sql dans l'historique Supabase
-- À exécuter APRÈS une application réussie de apply_sql_editor.sql, dans une nouvelle requête du SQL Editor.
-- Convention de l'historique de ce projet : version = horodatage UTC de l'inscription, nom court (publications_scheduled_flow), texte dans statements.
-- Refuse d'écrire si la migration n'est pas réellement en place (mêmes contrôles qu'après application) ou si elle est
-- déjà inscrite. Le texte inscrit est le fichier du dépôt, transporté en base64 : un copier-coller qui change les fins
-- de ligne (CRLF sous Windows) ou l'encodage ne peut pas l'altérer. Les corps de fonctions en base sont comparés à
-- ceux du dépôt en ignorant seulement les fins de ligne. Une seule transaction : en cas d'anomalie, rien n'est écrit.
-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/20261030000000_publications_scheduled_flow.sql (md5 20fd07ce0b96d799894b03ab3017526b, 11821 octets).
-- =========================================================================================================
begin;
do $sync$
declare
 expected_md5 constant text := '20fd07ce0b96d799894b03ab3017526b';
 migration_text text := convert_from(decode('
LS0gU29jbGUgUHVibGljYXRpb25zLCBsb3QgNiA6IHByw6lwYXJhdGlvbiBwbGFuaWZpw6llLCB2
YWxpZGF0aW9uIGh1bWFpbmUgZXQgZGlmZnVzaW9uIMOgIGwnaGV1cmUgcHLDqXZ1ZS4KLS0gTGUg
bW90ZXVyIGRlIGRpZmZ1c2lvbiAoUDEwLVAxMykgZXN0IGluY2hhbmfDqSA6IG5vdGlmaWNhdGlv
bnMsIGNhbmRpZGF0ZXMgZmlsdHLDqWVzIGVuIGJhc2UsIHLDqXNlcnZhdGlvbiDDoCBsJ2hldXJl
Ci0tICh0b2zDqXJhbmNlIGRlIHJldGFyZCksIHN1aXZpIGRlcyBwcsOpcGFyYXRpb25zIMOgIHJl
cHJlbmRyZSBldCBiYXR0ZW1lbnQgZHUgcGxhbmlmaWNhdGV1ciBzb250IGFqb3V0w6lzLiBVbmUg
cHVibGljYXRpb24gbidlc3QKLS0gZGlmZnVzw6llIHF1J2FwcHJvdXbDqWUgcGFyIHVuIGh1bWFp
biA7IHVuZSBtb2RpZmljYXRpb24gYXByw6hzIGFwcHJvYmF0aW9uIGxhIHJlcGFzc2UgZW4gYnJv
dWlsbG9uIGV0IGJsb3F1ZSBzZXMKLS0gZGlmZnVzaW9ucyAocHVibGljYXRpb25fc2F2ZV9kcmFm
dCwgZXhpc3RhbnQpIDsgdW4gcmVmdXMgbidlc3QgamFtYWlzIGRpZmZ1c8OpIChwdWJsaWNhdGlv
bl9wcmVwYXJlX2RlbGl2ZXJ5KS4KLS0gRm9yd2FyZC1vbmx5LiBBdWN1bmUgcHVibGljYXRpb24s
IGF1Y3VuZSBhcHByb2JhdGlvbiBhdXRvbWF0aXF1ZS4KCi0tIDEuIE5vdGlmaWNhdGlvbnMgOiDC
qyBQdWJsaWNhdGlvbiDDoCB2YWxpZGVyIMK7ICh2ZXJzIGxhIGZpbGUgZGUgdmFsaWRhdGlvbikg
ZXQgbGllbnMgdmVycyB1bmUgcHVibGljYXRpb24uCmFsdGVyIHRhYmxlIHB1YmxpYy5hZG1pbl9u
b3RpZmljYXRpb25zIGRyb3AgY29uc3RyYWludCBhZG1pbl9ub3RpZmljYXRpb25zX2NhdGVnb3J5
X2NoZWNrOwphbHRlciB0YWJsZSBwdWJsaWMuYWRtaW5fbm90aWZpY2F0aW9ucyBhZGQgY29uc3Ry
YWludCBhZG1pbl9ub3RpZmljYXRpb25zX2NhdGVnb3J5X2NoZWNrCiAgY2hlY2sgKGNhdGVnb3J5
IGluICgncmVwb3J0X3JlYWR5JywnYW5hbHlzaXNfY29tcGxldGVkJywnYW5hbHlzaXNfZmFpbGVk
JywnaW5jaWRlbnQnLCdkZWxpdmVyeV9mYWlsZWQnLCdtZWRpYV9yZWNlaXZlZCcsJ21lZGlhX21p
c3NpbmcnLCdwdWJsaWNhdGlvbl9yZXZpZXcnKSk7CmFsdGVyIHRhYmxlIHB1YmxpYy5hZG1pbl9u
b3RpZmljYXRpb25zIGRyb3AgY29uc3RyYWludCBhZG1pbl9ub3RpZmljYXRpb25zX2hyZWZfY2hl
Y2s7CmFsdGVyIHRhYmxlIHB1YmxpYy5hZG1pbl9ub3RpZmljYXRpb25zIGFkZCBjb25zdHJhaW50
IGFkbWluX25vdGlmaWNhdGlvbnNfaHJlZl9jaGVjawogIGNoZWNrIChocmVmIH4gJ14vKHJlcG9y
dHN8YWR2ZXJ0aXNpbmcvYW5hbHlzZXN8YWdlbnRzfHB1YmxpY2F0aW9ucykvWzAtOWEtZi1dezM2
fSQnIG9yIGhyZWY9Jy93b3JrP2tpbmQ9aW5jaWRlbnQnIG9yIGhyZWY9Jy9wdWJsaWNhdGlvbnMv
cmV2aWV3JwogICAgb3IgaHJlZiB+ICdeL2NsaWVudHMvWzAtOWEtZi1dezM2fVw/dGFiPW1lZGlh
JCcgb3IgaHJlZj0nL3NldHRpbmdzL3doYXRzYXBwJyBvciBocmVmPScvbm90aWZpY2F0aW9ucycp
OwphbHRlciB0YWJsZSBwdWJsaWMuYWRtaW5fbm90aWZpY2F0aW9uX3ByZWZlcmVuY2VzIGRyb3Ag
Y29uc3RyYWludCBhZG1pbl9ub3RpZmljYXRpb25fcHJlZmVyZW5jZXNfY2F0ZWdvcmllc19jaGVj
azsKYWx0ZXIgdGFibGUgcHVibGljLmFkbWluX25vdGlmaWNhdGlvbl9wcmVmZXJlbmNlcyBkcm9w
IGNvbnN0cmFpbnQgYWRtaW5fbm90aWZpY2F0aW9uX3ByZWZlcmVuY2VzX3B1c2hfY2F0ZWdvcmll
c19jaGVjazsKYWx0ZXIgdGFibGUgcHVibGljLmFkbWluX25vdGlmaWNhdGlvbl9wcmVmZXJlbmNl
cwogIGFkZCBjb25zdHJhaW50IGFkbWluX25vdGlmaWNhdGlvbl9wcmVmZXJlbmNlc19jYXRlZ29y
aWVzX2NoZWNrIGNoZWNrIChjYXRlZ29yaWVzIDxAIGFycmF5WydyZXBvcnRfcmVhZHknLCdhbmFs
eXNpc19jb21wbGV0ZWQnLCdhbmFseXNpc19mYWlsZWQnLCdpbmNpZGVudCcsJ2RlbGl2ZXJ5X2Zh
aWxlZCcsJ21lZGlhX3JlY2VpdmVkJywnbWVkaWFfbWlzc2luZycsJ3B1YmxpY2F0aW9uX3Jldmll
dyddKSwKICBhZGQgY29uc3RyYWludCBhZG1pbl9ub3RpZmljYXRpb25fcHJlZmVyZW5jZXNfcHVz
aF9jYXRlZ29yaWVzX2NoZWNrIGNoZWNrIChwdXNoX2NhdGVnb3JpZXMgPEAgYXJyYXlbJ3JlcG9y
dF9yZWFkeScsJ2FuYWx5c2lzX2NvbXBsZXRlZCcsJ2FuYWx5c2lzX2ZhaWxlZCcsJ2luY2lkZW50
JywnZGVsaXZlcnlfZmFpbGVkJywnbWVkaWFfcmVjZWl2ZWQnLCdtZWRpYV9taXNzaW5nJywncHVi
bGljYXRpb25fcmV2aWV3J10pLAogIGFsdGVyIGNvbHVtbiBjYXRlZ29yaWVzIHNldCBkZWZhdWx0
IGFycmF5WydyZXBvcnRfcmVhZHknLCdhbmFseXNpc19jb21wbGV0ZWQnLCdhbmFseXNpc19mYWls
ZWQnLCdpbmNpZGVudCcsJ2RlbGl2ZXJ5X2ZhaWxlZCcsJ21lZGlhX3JlY2VpdmVkJywnbWVkaWFf
bWlzc2luZycsJ3B1YmxpY2F0aW9uX3JldmlldyddOwp1cGRhdGUgcHVibGljLmFkbWluX25vdGlm
aWNhdGlvbl9wcmVmZXJlbmNlcyBzZXQgY2F0ZWdvcmllcyA9IGFycmF5X2FwcGVuZChjYXRlZ29y
aWVzLCAncHVibGljYXRpb25fcmV2aWV3Jykgd2hlcmUgbm90ICgncHVibGljYXRpb25fcmV2aWV3
JyA9IGFueShjYXRlZ29yaWVzKSk7CmNyZWF0ZSBvciByZXBsYWNlIGZ1bmN0aW9uIHB1YmxpYy5j
b2Rldl91bnJlYWRfbm90aWZpY2F0aW9ucyhwX3VzZXJfaWQgdGV4dCkgcmV0dXJucyBiaWdpbnQg
bGFuZ3VhZ2Ugc3FsIHNlY3VyaXR5IGludm9rZXIgc2V0IHNlYXJjaF9wYXRoPXBnX2NhdGFsb2cg
YXMgJCQKIHNlbGVjdCBjb3VudCgqKSBmcm9tIHB1YmxpYy5hZG1pbl9ub3RpZmljYXRpb25zIG4g
d2hlcmUgbi5jYXRlZ29yeT1hbnkoY29hbGVzY2UoKHNlbGVjdCBjYXRlZ29yaWVzIGZyb20gcHVi
bGljLmFkbWluX25vdGlmaWNhdGlvbl9wcmVmZXJlbmNlcyB3aGVyZSB1c2VyX2lkPXBfdXNlcl9p
ZCksCiAgYXJyYXlbJ3JlcG9ydF9yZWFkeScsJ2FuYWx5c2lzX2NvbXBsZXRlZCcsJ2FuYWx5c2lz
X2ZhaWxlZCcsJ2luY2lkZW50JywnZGVsaXZlcnlfZmFpbGVkJywnbWVkaWFfcmVjZWl2ZWQnLCdt
ZWRpYV9taXNzaW5nJywncHVibGljYXRpb25fcmV2aWV3J10pKQogYW5kIG5vdCBleGlzdHMoc2Vs
ZWN0IDEgZnJvbSBwdWJsaWMuYWRtaW5fbm90aWZpY2F0aW9uX3JlYWRzIHIgd2hlcmUgci51c2Vy
X2lkPXBfdXNlcl9pZCBhbmQgci5ub3RpZmljYXRpb25faWQ9bi5pZCk7CiQkOwoKLS0gMi4gw4lj
aGVjIG91IGluY2VydGl0dWRlIGQndW5lIGRpZmZ1c2lvbiA6IHVuZSBub3RpZmljYXRpb24gcGFy
IGRpZmZ1c2lvbiBldCBwYXIgw6l0YXQsIHZlcnMgbGEgcHVibGljYXRpb24uCi0tIEF1Y3VuIHRl
eHRlLCBjb21wdGUgbmkgY29kZSBkJ2VycmV1ciBkYW5zIGxhIG5vdGlmaWNhdGlvbiAoY29uc3Vs
dGFibGVzIHN1ciBsYSBmaWNoZSwgcsOpc2VydsOpZSDDoCBsJ2FkbWluKS4KY3JlYXRlIGZ1bmN0
aW9uIHB1YmxpY2F0aW9uc19wcml2YXRlLmRlbGl2ZXJ5X2ZhaWx1cmVfbm90aWZpY2F0aW9uKCkg
cmV0dXJucyB0cmlnZ2VyCmxhbmd1YWdlIHBscGdzcWwgc2VjdXJpdHkgaW52b2tlciBzZXQgc2Vh
cmNoX3BhdGg9cGdfY2F0YWxvZyBhcyAkJApiZWdpbgogaW5zZXJ0IGludG8gcHVibGljLmFkbWlu
X25vdGlmaWNhdGlvbnMoZXZlbnRfa2V5LGNhdGVnb3J5LGhyZWYpCiB2YWx1ZXMoJ3B1YmxpY2F0
aW9uLWRlbGl2ZXJ5Oid8fG5ldy5pZDo6dGV4dHx8JzonfHxuZXcuc3RhdHVzLCdkZWxpdmVyeV9m
YWlsZWQnLCcvcHVibGljYXRpb25zLyd8fG5ldy5wdWJsaWNhdGlvbl9pZDo6dGV4dCkKIG9uIGNv
bmZsaWN0KGV2ZW50X2tleSkgZG8gbm90aGluZzsKIHJldHVybiBuZXc7CmVuZCAkJDsKLS0gQmxv
Y2FnZSBhdXNzaSAoY29ubmV4aW9uIGV4cGlyw6llLCByZWZ1cyBkJ2F1dGhlbnRpZmljYXRpb24s
IGNhbmFsIG5vbiBwdWJsaWFibGUsIHJldGFyZCBhdS1kZWzDoCBkZSBsYSB0b2zDqXJhbmNlIDoK
LS0gdG91am91cnMgYXZlYyB1biBtb3RpZikgOyBqYW1haXMgcG91ciB1biBibG9jYWdlIGNhdXPD
qSBwYXIgdW4gaHVtYWluIChtb2RpZmljYXRpb24gYXByw6hzIGFwcHJvYmF0aW9uLCBzYW5zIG1v
dGlmIG91Ci0tIHB1YmxpY2F0aW9uX2NoYW5nZWQgLyBjb250ZW50X2NoYW5nZWQsIGFyY2hpdmFn
ZSkgOiByaWVuIMOgIHNpZ25hbGVyLgpjcmVhdGUgdHJpZ2dlciBwdWJsaWNhdGlvbl9kZWxpdmVy
eV9mYWlsdXJlX25vdGlmaWNhdGlvbiBhZnRlciB1cGRhdGUgb2Ygc3RhdHVzIG9uIHB1YmxpYy5w
dWJsaWNhdGlvbl9kZWxpdmVyaWVzCiBmb3IgZWFjaCByb3cgd2hlbiAobmV3LnN0YXR1cyBpbiAo
J2ZhaWxlZCcsJ3VuY2VydGFpbicsJ2Jsb2NrZWQnKSBhbmQgb2xkLnN0YXR1cyBpcyBkaXN0aW5j
dCBmcm9tIG5ldy5zdGF0dXMKICBhbmQgKG5ldy5zdGF0dXM8PidibG9ja2VkJyBvciAobmV3LmJs
b2NrZWRfcmVhc29uIGlzIG5vdCBudWxsIGFuZCBuZXcuYmxvY2tlZF9yZWFzb24gbm90IGluICgn
cHVibGljYXRpb25fY2hhbmdlZCcsJ2NvbnRlbnRfY2hhbmdlZCcsJ2FyY2hpdmVkJykpKSkKIGV4
ZWN1dGUgZnVuY3Rpb24gcHVibGljYXRpb25zX3ByaXZhdGUuZGVsaXZlcnlfZmFpbHVyZV9ub3Rp
ZmljYXRpb24oKTsKCnJldm9rZSBhbGwgb24gZnVuY3Rpb24gcHVibGljYXRpb25zX3ByaXZhdGUu
ZGVsaXZlcnlfZmFpbHVyZV9ub3RpZmljYXRpb24oKSBmcm9tIHB1YmxpYyxhbm9uLGF1dGhlbnRp
Y2F0ZWQsc2VydmljZV9yb2xlOwpncmFudCBleGVjdXRlIG9uIGZ1bmN0aW9uIHB1YmxpY2F0aW9u
c19wcml2YXRlLmRlbGl2ZXJ5X2ZhaWx1cmVfbm90aWZpY2F0aW9uKCkgdG8gc2VydmljZV9yb2xl
OwoKLS0gMy4gUm90YXRpb24gw6lxdWl0YWJsZSBkZXMgY2xpZW50cyBlbiBwcsOpcGFyYXRpb24g
YXV0b21hdGlxdWUgOiBsZSBtb2lucyByw6ljZW1tZW50IHRyYWl0w6kgZCdhYm9yZCAobnVsbCA9
IGphbWFpcykuCmFsdGVyIHRhYmxlIHB1YmxpYy5wdWJsaWNhdGlvbl9jbGllbnRfc2V0dGluZ3Mg
YWRkIGNvbHVtbiBsYXN0X2F1dG9fcHJlcGFyZWRfYXQgdGltZXN0YW1wdHo7CmNyZWF0ZSBpbmRl
eCBwdWJsaWNhdGlvbl9jbGllbnRfc2V0dGluZ3NfYXV0b19yb3RhdGlvbiBvbiBwdWJsaWMucHVi
bGljYXRpb25fY2xpZW50X3NldHRpbmdzKGxhc3RfYXV0b19wcmVwYXJlZF9hdCBudWxscyBmaXJz
dCxjbGllbnRfaWQpCiB3aGVyZSBhdXRvX3ByZXBhcmVfZW5hYmxlZCBhbmQgZ2VuZXJhdGlvbl9l
bmFibGVkOwoKLS0gNC4gU3VpdmkgZGVzIHByw6lwYXJhdGlvbnMgcGxhbmlmacOpZXMgZG9udCBs
J8OpdGFwZSBtw6lkaWEgb3UgbGEgc291bWlzc2lvbiByZXN0ZSDDoCBmaW5pciAocmVwcmlzZSBz
YW5zIElBKS4KLS0gb3BlbiDihpIgZG9uZSAocGhvdG8gYXR0YWNow6llIGV0IGJyb3VpbGxvbnMg
c291bWlzLCBvdSByaWVuIMOgIGZhaXJlKSB8IGdhdmVfdXAgKHBob3RvIGFiYW5kb25uw6llLCBy
w6lzZXJ2YXRpb24gbGliw6lyw6llKS4KY3JlYXRlIHRhYmxlIHB1YmxpYy5wdWJsaWNhdGlvbl9z
Y2hlZHVsZWRfcnVucygKIHJ1bl9pZCB1dWlkIHByaW1hcnkga2V5LAogY2xpZW50X2lkIHV1aWQg
bm90IG51bGwsCiBzdGF0ZSB0ZXh0IG5vdCBudWxsIGRlZmF1bHQgJ29wZW4nIGNoZWNrKHN0YXRl
IGluKCdvcGVuJywnZG9uZScsJ2dhdmVfdXAnKSksCiBjcmVhdGVkX2F0IHRpbWVzdGFtcHR6IG5v
dCBudWxsIGRlZmF1bHQgbm93KCksCiB1cGRhdGVkX2F0IHRpbWVzdGFtcHR6IG5vdCBudWxsIGRl
ZmF1bHQgbm93KCksCiBmb3JlaWduIGtleShydW5faWQsY2xpZW50X2lkKSByZWZlcmVuY2VzIHB1
YmxpYy5wdWJsaWNhdGlvbl9hZ2VudF92Ml9ydW5zKGlkLGNsaWVudF9pZCkgb24gZGVsZXRlIHJl
c3RyaWN0Cik7CmNyZWF0ZSBpbmRleCBwdWJsaWNhdGlvbl9zY2hlZHVsZWRfcnVuc19vcGVuIG9u
IHB1YmxpYy5wdWJsaWNhdGlvbl9zY2hlZHVsZWRfcnVucyhjcmVhdGVkX2F0KSB3aGVyZSBzdGF0
ZT0nb3Blbic7CmFsdGVyIHRhYmxlIHB1YmxpYy5wdWJsaWNhdGlvbl9zY2hlZHVsZWRfcnVucyBl
bmFibGUgcm93IGxldmVsIHNlY3VyaXR5OwpyZXZva2UgYWxsIG9uIHB1YmxpYy5wdWJsaWNhdGlv
bl9zY2hlZHVsZWRfcnVucyBmcm9tIHB1YmxpYyxhbm9uLGF1dGhlbnRpY2F0ZWQsc2VydmljZV9y
b2xlOwpncmFudCBzZWxlY3QsaW5zZXJ0LHVwZGF0ZSBvbiBwdWJsaWMucHVibGljYXRpb25fc2No
ZWR1bGVkX3J1bnMgdG8gc2VydmljZV9yb2xlOwoKLS0gNS4gQ2FuZGlkYXRlcyDDoCBsYSBkaWZm
dXNpb24gcGxhbmlmacOpZSwgZmlsdHLDqWVzIGVuIGJhc2UgOiBhcHByb3V2w6llcywgbm9uIGFy
Y2hpdsOpZXMsIGxpw6llcyDDoCB1biBjcsOpbmVhdSwgc2FucwotLSBkaWZmdXNpb24gcG91ciBs
ZXVyIHLDqXZpc2lvbiBjb3VyYW50ZS4gc3RhdGUgOgotLSAgcmVhZHkgICAgICAgICAgICAgICBj
csOpbmVhdSDDoCB2ZW5pciAob3UgcGFzc8OpIGRlcHVpcyBtb2lucyBxdWUgbGEgdG9sw6lyYW5j
ZSkgOwotLSAgbWlzc2VkICAgICAgICAgICAgICBjcsOpbmVhdSBwYXNzw6kgYXUtZGVsw6AgZGUg
bGEgdG9sw6lyYW5jZSAoNyBqb3VycyBhdSBwbHVzKSwgcGFzIGVuY29yZSBzaWduYWzDqSA7Ci0t
ICBwaG90b191bnB1Ymxpc2hhYmxlIHBob3RvIGRlIGxhIHBob3RvdGjDqHF1ZSBkZXZlbnVlIG5v
biBwdWJsaWFibGUgKHF1YXJhbnRhaW5lLCByZWpldCwgYXJjaGl2YWdlLCBwdXJnZSwKLS0gICAg
ICAgICAgICAgICAgICAgICAgw6l2YWx1YXRpb24gY29uZmlkZW50aWVsbGUgb3UgaG9ycyBzdWpl
dCksIHBhcyBlbmNvcmUgc2lnbmFsw6llLgotLSBVbmUgcHVibGljYXRpb24gc2lnbmFsw6llIG4n
ZXN0IHBsdXMgcmVudm95w6llIDogbGEgbGlzdGUgbmUgZ3Jvc3NpdCBwYXMgYXZlYyBsJ2hpc3Rv
cmlxdWUuCmNyZWF0ZSBmdW5jdGlvbiBwdWJsaWMucHVibGljYXRpb25fc2NoZWR1bGVkX2RlbGl2
ZXJ5X2NhbmRpZGF0ZXMocF9sYXRlX2JlZm9yZSB0aW1lc3RhbXB0eixwX2xpbWl0IGludGVnZXIp
CnJldHVybnMgdGFibGUocHVibGljYXRpb25faWQgdXVpZCxyZXZpc2lvbl9pZCB1dWlkLHNjaGVk
dWxlZF9mb3IgdGltZXN0YW1wdHosc3RhdGUgdGV4dCkKbGFuZ3VhZ2Ugc3FsIHN0YWJsZSBzZWN1
cml0eSBpbnZva2VyIHNldCBzZWFyY2hfcGF0aD1wZ19jYXRhbG9nIGFzICQkCiBzZWxlY3QgYy5w
dWJsaWNhdGlvbl9pZCxjLnJldmlzaW9uX2lkLGMuc2NoZWR1bGVkX2ZvcixjLnN0YXRlIGZyb20g
KAogIHNlbGVjdCBwLmlkIHB1YmxpY2F0aW9uX2lkLHAuY3VycmVudF9yZXZpc2lvbl9pZCByZXZp
c2lvbl9pZCxvLnNjaGVkdWxlZF9mb3IsCiAgIGNhc2Ugd2hlbiBvLnNjaGVkdWxlZF9mb3I8cF9s
YXRlX2JlZm9yZSB0aGVuICdtaXNzZWQnCiAgICB3aGVuIGV4aXN0cyhzZWxlY3QgMSBmcm9tIHB1
YmxpYy53aGF0c2FwcF9hc3NldF91c2VzIHUgam9pbiBwdWJsaWMud2hhdHNhcHBfYXNzZXRzIGEg
b24gYS5pZD11LmFzc2V0X2lkIGFuZCBhLmNsaWVudF9pZD11LmNsaWVudF9pZAogICAgIHdoZXJl
IHUucHVibGljYXRpb25faWQ9cC5pZCBhbmQgdS5jbGllbnRfaWQ9cC5jbGllbnRfaWQgYW5kIG5v
dCBwdWJsaWNhdGlvbnNfcHJpdmF0ZS5saWJyYXJ5X2Fzc2V0X3B1Ymxpc2hhYmxlKGEpCiAgICAg
IGFuZCAodS5wdWJsaWNhdGlvbl9hc3NldF9pZCBpcyBudWxsIG9yIHUucHVibGljYXRpb25fYXNz
ZXRfaWQgaW4oc2VsZWN0IHZhLmFzc2V0X2lkIGZyb20gcHVibGljLnB1YmxpY2F0aW9uX3Zhcmlh
bnRfYXNzZXRzIHZhCiAgICAgICBqb2luIHB1YmxpYy5wdWJsaWNhdGlvbl92YXJpYW50cyB2IG9u
IHYuaWQ9dmEudmFyaWFudF9pZCB3aGVyZSB2LnJldmlzaW9uX2lkPXAuY3VycmVudF9yZXZpc2lv
bl9pZCBhbmQgdi5wdWJsaWNhdGlvbl9pZD1wLmlkKSkpIHRoZW4gJ3Bob3RvX3VucHVibGlzaGFi
bGUnCiAgICBlbHNlICdyZWFkeScgZW5kIHN0YXRlCiAgZnJvbSBwdWJsaWMucHVibGljYXRpb25z
IHAgam9pbiBwdWJsaWMucHVibGljYXRpb25fY2hhbm5lbF9vY2N1cnJlbmNlcyBvIG9uIG8uaWQ9
cC5vY2N1cnJlbmNlX2lkCiAgd2hlcmUgcC5zdGF0dXM9J2FwcHJvdmVkJyBhbmQgcC5hcmNoaXZl
ZF9hdCBpcyBudWxsIGFuZCBwLmN1cnJlbnRfcmV2aXNpb25faWQgaXMgbm90IG51bGwKICAgYW5k
IG8uc2NoZWR1bGVkX2Zvcj49cF9sYXRlX2JlZm9yZS1pbnRlcnZhbCAnNyBkYXlzJwogICBhbmQg
bm90IGV4aXN0cyhzZWxlY3QgMSBmcm9tIHB1YmxpYy5wdWJsaWNhdGlvbl9kZWxpdmVyaWVzIGQg
d2hlcmUgZC5wdWJsaWNhdGlvbl9pZD1wLmlkIGFuZCBkLnJldmlzaW9uX2lkPXAuY3VycmVudF9y
ZXZpc2lvbl9pZCkpIGMKIHdoZXJlIGMuc3RhdGU9J3JlYWR5JyBvciBub3QgZXhpc3RzKHNlbGVj
dCAxIGZyb20gcHVibGljLmFkbWluX25vdGlmaWNhdGlvbnMgbgogIHdoZXJlIG4uZXZlbnRfa2V5
PSdwdWJsaWNhdGlvbi0nfHxyZXBsYWNlKGMuc3RhdGUsJ18nLCctJyl8fCc6J3x8Yy5wdWJsaWNh
dGlvbl9pZDo6dGV4dHx8JzonfHxjLnJldmlzaW9uX2lkOjp0ZXh0KQogb3JkZXIgYnkgYy5zdGF0
ZTw+J3JlYWR5JyxjLnNjaGVkdWxlZF9mb3IsYy5wdWJsaWNhdGlvbl9pZAogbGltaXQgbGVhc3Qo
Z3JlYXRlc3QoY29hbGVzY2UocF9saW1pdCwxKSwxKSwxMDApOwokJDsKCi0tIDYuIFLDqXNlcnZh
dGlvbiBkdSBwbGFuaWZpY2F0ZXVyIDogamFtYWlzIGQnZW52b2kgcGx1cyBlbiByZXRhcmQgcXVl
IGxhIHRvbMOpcmFuY2UuIExlcyB0w6JjaGVzIGR1ZXMgZGVwdWlzIHBsdXMKLS0gbG9uZ3RlbXBz
IChqYW1haXMgZW52b3nDqWVzIDogc2FucyBtYXJxdWV1ciBkJ2Vudm9pKSBzb250IGJsb3F1w6ll
cyBhdmVjIGxlIG1vdGlmIGxhdGVfc2NoZWR1bGUgKG5vdGlmacOpLCByZWxhbmNlCi0tIG1hbnVl
bGxlIHBvc3NpYmxlIGRlcHVpcyBsYSBmaWNoZSksIHB1aXMgbGEgcsOpc2VydmF0aW9uIGV4aXN0
YW50ZSAocHVibGljYXRpb25fam9iX2NsYWltKSBzJ2FwcGxpcXVlIHRlbGxlIHF1ZWxsZS4KLS0g
TGUgYm91dG9uIGR1IGNvY2twaXQgZ2FyZGUgcHVibGljYXRpb25fam9iX2NsYWltICh1biBodW1h
aW4gZMOpY2lkZSBkJ2Vudm95ZXIpLgpjcmVhdGUgZnVuY3Rpb24gcHVibGljLnB1YmxpY2F0aW9u
X2pvYl9jbGFpbV9vbl90aW1lKHBfd29ya2VyX2lkIHRleHQscF9sZWFzZV9zZWNvbmRzIGludGVn
ZXIscF9tYXhfbGF0ZV9zZWNvbmRzIGludGVnZXIpIHJldHVybnMganNvbmIKbGFuZ3VhZ2UgcGxw
Z3NxbCBzZWN1cml0eSBpbnZva2VyIHNldCBzZWFyY2hfcGF0aD1wZ19jYXRhbG9nIGFzICQkCmRl
Y2xhcmUgaiByZWNvcmQ7biBpbnRlZ2VyOj0wOwpiZWdpbgogaWYgcF9tYXhfbGF0ZV9zZWNvbmRz
IGlzIG51bGwgb3IgcF9tYXhfbGF0ZV9zZWNvbmRzIG5vdCBiZXR3ZWVuIDYwIGFuZCA4NjQwMCB0
aGVuIHJhaXNlIGV4Y2VwdGlvbiAnSW52YWxpZCBjbGFpbScgdXNpbmcgZXJyY29kZT0nMjIwMjMn
OyBlbmQgaWY7CiBpZiBjb2FsZXNjZSgoc2VsZWN0IGVtZXJnZW5jeV9zdG9wIGZyb20gcHVibGlj
LnB1YmxpY2F0aW9uX3NldHRpbmdzIGxpbWl0IDEpLHRydWUpIHRoZW4gcmV0dXJuIG51bGw7IGVu
ZCBpZjsKIGZvciBqIGluIHNlbGVjdCBwai5kZWxpdmVyeV9pZCBmcm9tIHB1YmxpYy5wdWJsaWNh
dGlvbl9qb2JzIHBqIGpvaW4gcHVibGljLnB1YmxpY2F0aW9uX2RlbGl2ZXJpZXMgZCBvbiBkLmlk
PXBqLmRlbGl2ZXJ5X2lkCiAgIHdoZXJlIHBqLnR5cGU9J2RlbGl2ZXInIGFuZCBwai5kaXNwYXRj
aGVkX2F0IGlzIG51bGwgYW5kIHBqLnJ1bl9hdDxub3coKS1tYWtlX2ludGVydmFsKHNlY3M9PnBf
bWF4X2xhdGVfc2Vjb25kcykKICAgIGFuZCAocGouc3RhdHVzPSdwZW5kaW5nJyBvciAocGouc3Rh
dHVzPSdwcm9jZXNzaW5nJyBhbmQgcGoubGVhc2VfZXhwaXJlc19hdDw9bm93KCkpKQogICAgYW5k
IGQuc3RhdHVzIGluKCdzY2hlZHVsZWQnLCdyZXRyeWFibGVfZXJyb3InLCdwcm9jZXNzaW5nJykg
YW5kIGQucmV2aXNpb25faWQgaXMgbm90IG51bGwKICAgb3JkZXIgYnkgcGoucnVuX2F0LHBqLmlk
IGxpbWl0IDUwIGZvciB1cGRhdGUgb2YgcGogc2tpcCBsb2NrZWQgbG9vcAogIHBlcmZvcm0gcHVi
bGljYXRpb25zX3ByaXZhdGUuYmxvY2tfZGVsaXZlcnkoai5kZWxpdmVyeV9pZCwnbGF0ZV9zY2hl
ZHVsZScpO246PW4rMTsKIGVuZCBsb29wOwogLS0gRW5jb3JlIGRlcyByZXRhcmRzIMOgIGJsb3F1
ZXIgOiByaWVuIG4nZXN0IGVudm95w6kgZGFucyBjZSBwYXNzYWdlIChsZSBzdWl2YW50IGNvbnRp
bnVlKS4KIGlmIG49NTAgdGhlbiByZXR1cm4gbnVsbDsgZW5kIGlmOwogcmV0dXJuIHB1YmxpYy5w
dWJsaWNhdGlvbl9qb2JfY2xhaW0ocF93b3JrZXJfaWQscF9sZWFzZV9zZWNvbmRzKTsKZW5kICQk
OwoKLS0gNy4gQmF0dGVtZW50IGR1IHBsYW5pZmljYXRldXIgOiB1bmUgbGlnbmUgcGFyIG5vbSAo
wqsgc2NoZWR1bGVyX3RpY2sgwrspLCByw6nDqWNyaXRlIMOgIGNoYXF1ZSBwYXNzYWdlLiDDiXRh
cGVzIOKGkgotLSB7c3RhdHVzOiBva3xmYWlsZWR8c2tpcHBlZHxkaXNhYmxlZCwgbXMsIGNvdW50
cz99IDsgamFtYWlzIGRlIHRleHRlLCBkJ2lkZW50aWZpYW50IG5pIGRlIGNvbnRlbnUuIExvdCA3
IGwnYWZmaWNoZS4KY3JlYXRlIHRhYmxlIHB1YmxpYy5zY2hlZHVsZXJfaGVhcnRiZWF0cygKIG5h
bWUgdGV4dCBwcmltYXJ5IGtleSBjaGVjayhuYW1lIH4gJ15bYS16XVthLXowLTlfXXswLDM5fSQn
KSwKIHN0YXJ0ZWRfYXQgdGltZXN0YW1wdHogbm90IG51bGwsCiBmaW5pc2hlZF9hdCB0aW1lc3Rh
bXB0eiwKIG9rIGJvb2xlYW4gbm90IG51bGwgZGVmYXVsdCBmYWxzZSwKIHN0ZXBzIGpzb25iIG5v
dCBudWxsIGRlZmF1bHQgJ3t9Jzo6anNvbmIgY2hlY2soanNvbmJfdHlwZW9mKHN0ZXBzKT0nb2Jq
ZWN0JyBhbmQgb2N0ZXRfbGVuZ3RoKHN0ZXBzOjp0ZXh0KTw9ODE5MgogIGFuZCBub3QganNvbmJf
cGF0aF9leGlzdHMoc3RlcHMsJyQuKiA/IChALnR5cGUoKSAhPSAib2JqZWN0IiB8fCAhKEAuc3Rh
dHVzID09ICJvayIgfHwgQC5zdGF0dXMgPT0gImZhaWxlZCIgfHwgQC5zdGF0dXMgPT0gInNraXBw
ZWQiIHx8IEAuc3RhdHVzID09ICJkaXNhYmxlZCIpKScpKSwKIGxhc3Rfc3VjY2Vzc19hdCB0aW1l
c3RhbXB0eiwKIGxhc3RfZmFpbHVyZV9hdCB0aW1lc3RhbXB0eiwKIHVwZGF0ZWRfYXQgdGltZXN0
YW1wdHogbm90IG51bGwgZGVmYXVsdCBub3coKQopOwphbHRlciB0YWJsZSBwdWJsaWMuc2NoZWR1
bGVyX2hlYXJ0YmVhdHMgZW5hYmxlIHJvdyBsZXZlbCBzZWN1cml0eTsKcmV2b2tlIGFsbCBvbiBw
dWJsaWMuc2NoZWR1bGVyX2hlYXJ0YmVhdHMgZnJvbSBwdWJsaWMsYW5vbixhdXRoZW50aWNhdGVk
LHNlcnZpY2Vfcm9sZTsKZ3JhbnQgc2VsZWN0LGluc2VydCx1cGRhdGUgb24gcHVibGljLnNjaGVk
dWxlcl9oZWFydGJlYXRzIHRvIHNlcnZpY2Vfcm9sZTsKCnJldm9rZSBhbGwgb24gZnVuY3Rpb24g
cHVibGljLnB1YmxpY2F0aW9uX3NjaGVkdWxlZF9kZWxpdmVyeV9jYW5kaWRhdGVzKHRpbWVzdGFt
cHR6LGludGVnZXIpLHB1YmxpYy5wdWJsaWNhdGlvbl9qb2JfY2xhaW1fb25fdGltZSh0ZXh0LGlu
dGVnZXIsaW50ZWdlcikgZnJvbSBwdWJsaWMsYW5vbixhdXRoZW50aWNhdGVkOwpncmFudCBleGVj
dXRlIG9uIGZ1bmN0aW9uIHB1YmxpYy5wdWJsaWNhdGlvbl9zY2hlZHVsZWRfZGVsaXZlcnlfY2Fu
ZGlkYXRlcyh0aW1lc3RhbXB0eixpbnRlZ2VyKSxwdWJsaWMucHVibGljYXRpb25fam9iX2NsYWlt
X29uX3RpbWUodGV4dCxpbnRlZ2VyLGludGVnZXIpIHRvIHNlcnZpY2Vfcm9sZTsKbm90aWZ5IHBn
cnN0LCAncmVsb2FkIHNjaGVtYSc7Cg==
', 'base64'), 'UTF8');
begin
 if exists(select 1 from supabase_migrations.schema_migrations where (name='publications_scheduled_flow' or name ~ '^[0-9]{14}_publications_scheduled_flow$')) then
  raise exception 'ARRET : la migration 20261030000000 est déjà inscrite dans l''historique'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'))='f250ec2e20baddad4a23ccad5695dca2',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_job_claim_on_time(text,integer,integer)'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_job_claim_on_time(text,integer,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'))='d52dc3ee8b9bfe287fa155640598180a',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.publication_scheduled_delivery_candidates(timestamp with time zone,integer)'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.publication_scheduled_delivery_candidates(timestamp with time zone,integer) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('publications_private.delivery_failure_notification()'))='7f8c3597e896d5ba9706f1c2cefe2cbb',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.delivery_failure_notification() : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('publications_private.delivery_failure_notification()')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.delivery_failure_notification() : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('publications_private.delivery_failure_notification()'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction publications_private.delivery_failure_notification() : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.codev_unread_notifications(text)'))='89f33a3d67b18227e584143dfc11f42a',false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.codev_unread_notifications(text) : présente, code identique au dépôt'; end if;
 if not (coalesce((select prosecdef=false and coalesce(array_to_string(proconfig,','),'')='search_path=pg_catalog' from pg_proc where oid=to_regprocedure('public.codev_unread_notifications(text)')),false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.codev_unread_notifications(text) : SECURITY INVOKER, search_path search_path=pg_catalog'; end if;
 if not (coalesce(not has_function_privilege('public',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE') and has_function_privilege('service_role',to_regprocedure('public.codev_unread_notifications(text)'),'EXECUTE')=true,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'fonction public.codev_unread_notifications(text) : EXECUTE interdit à public, anon et authenticated, accordé à service_role'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.publication_scheduled_runs')),false)=true) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.publication_scheduled_runs : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'SELECT') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'INSERT') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'UPDATE') or has_table_privilege('anon',to_regclass('public.publication_scheduled_runs'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.publication_scheduled_runs'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.publication_scheduled_runs'),'DELETE')=false,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.publication_scheduled_runs : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.scheduler_heartbeats')),false)=true) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.scheduler_heartbeats : présente, RLS active'; end if;
 if not (coalesce(not (has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'SELECT') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'INSERT') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'UPDATE') or has_table_privilege('anon',to_regclass('public.scheduler_heartbeats'),'DELETE')
        or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'SELECT') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'INSERT') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'UPDATE') or has_table_privilege('authenticated',to_regclass('public.scheduler_heartbeats'),'DELETE'))
       and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'SELECT')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'INSERT')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'UPDATE')=true and has_table_privilege('service_role',to_regclass('public.scheduler_heartbeats'),'DELETE')=false,false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'table public.scheduler_heartbeats : aucun droit pour anon et authenticated, service_role SELECT,INSERT,UPDATE'; end if;
 if not (exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.publication_client_settings') and a.attname='last_auto_prepared_at' and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)='timestamp with time zone' and a.attnotnull=false and coalesce(pg_get_expr(d.adbin,d.adrelid),'')='')) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'colonne public.publication_client_settings.last_auto_prepared_at : timestamp with time zone'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_client_settings_auto_rotation') and indrelid=to_regclass('public.publication_client_settings') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.publication_client_settings_auto_rotation sur public.publication_client_settings : présent et valide'; end if;
 if not (exists(select 1 from pg_index where indexrelid=to_regclass('public.publication_scheduled_runs_open') and indrelid=to_regclass('public.publication_scheduled_runs') and indisvalid and indisunique=false)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'index public.publication_scheduled_runs_open sur public.publication_scheduled_runs : présent et valide'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notification_preferences') and conname='admin_notification_preferences_categories_check' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte admin_notification_preferences_categories_check sur public.admin_notification_preferences : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notification_preferences') and conname='admin_notification_preferences_push_categories_check' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte admin_notification_preferences_push_categories_check sur public.admin_notification_preferences : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notifications') and conname='admin_notifications_category_check' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte admin_notifications_category_check sur public.admin_notifications : présente et validée'; end if;
 if not (exists(select 1 from pg_constraint where conrelid=to_regclass('public.admin_notifications') and conname='admin_notifications_href_check' and contype='c' and convalidated)) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'contrainte admin_notifications_href_check sur public.admin_notifications : présente et validée'; end if;
 if not (exists(select 1 from pg_trigger where tgrelid=to_regclass('public.publication_deliveries') and tgname='publication_delivery_failure_notification' and tgenabled='O' and tgfoid=to_regprocedure('publications_private.delivery_failure_notification()'))) then raise exception 'ARRET (migration non appliquée ou différente du dépôt) : %', 'déclencheur publication_delivery_failure_notification sur public.publication_deliveries : présent, actif, appelle publications_private.delivery_failure_notification()'; end if;
 if md5(migration_text)<>expected_md5 then
  raise exception 'ARRET : texte décodé inattendu (md5 %, % octets)', md5(migration_text), octet_length(migration_text); end if;
 insert into supabase_migrations.schema_migrations(version, name, statements)
 values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'publications_scheduled_flow', array[migration_text]);
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name='publications_scheduled_flow')<>expected_md5 then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
 raise notice 'Migration 20261030000000 inscrite dans l''historique.';
end $sync$;
commit;

select version, name, md5(statements[1]) as md5_texte, octet_length(statements[1]) as octets
  from supabase_migrations.schema_migrations order by version desc limit 3;
