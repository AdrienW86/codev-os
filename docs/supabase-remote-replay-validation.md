# Reproduction locale du schéma Supabase distant

Validation du 5 octobre 2026. **Les quatre migrations inchangées passent sur une reproduction locale vérifiée du schéma métier distant. Aucune modification distante, aucun durcissement supplémentaire des permissions historiques.**

Ce rapport décrit l'état avant 00004. Le [lot de durcissement autorisé ensuite](historical-permissions-hardening.md) révoque les ACL historiques locales, protège leur conservation et valide cinq migrations ; les résultats ci-dessous restent ceux du témoin à quatre migrations.

## Fidélité et méthode

Un inventaire des catalogues a été lu via Supabase dans une transaction READ ONLY terminée par ROLLBACK. Aucun enregistrement métier distant importé. `supabase/local/remote-schema-snapshot.json` contient uniquement les définitions, propriétaires et ACL des objets de public.

`supabase/local/remote-schema.sql` est une fixture historique locale, distincte de `supabase/local/baseline.sql` et des migrations. **Aucun de ces deux fichiers historiques ne doit être appliqué au distant.**

Avant migration, PostgreSQL compare réellement la reproduction à l'instantané : 13 tables, 125 colonnes (type, précision, nullabilité, default), 38 contraintes (FK et suppressions comprises), 39 index, 2 fonctions avec définition/ACL, 8 triggers et 6 ACL par défaut de public. Propriétaires postgres, RLS et absence de policies vérifiés. Les cardinalités détectent les objets manquants ou supplémentaires.

Toutes les différences demandées sont reproduites : client_events, resource_id TEXT, CASCADE historiques, SET NULL, defaults Normale/inactive/draft/not_connected/active/enabled=true, types numériques précis, contrôles et unicités, fonctions updated_at et immutabilité audit.

Limites : PostgreSQL portable Windows 17.11, pas la distribution managée 17.11.0.002. Services API/Auth/Storage, extensions/schémas système, infrastructure, collations/configuration managée et rôles internes complets non reproduits. Les rôles de test sont locaux sans connexion ; service_role BYPASSRLS. OID et données physiques non copiés ; les valeurs des catalogues métier contrôlés concordent. Pas de test de concurrence multi-session.

Fixtures entièrement fictives : 2 clients, 0 projet, 1 tâche, 2 agents Actif/enabled dont un non assigné, 1 assignation client enabled, 1 run completed, 1 recommandation, 1 action executed, 1 message et 15 audits. Ces audits comprennent des resource_id textuels non UUID. Services/connexions/événements initialement vides, puis lignes synthétiques ajoutées pour les essais TRUNCATE.

Chaque reconstruction : schéma vérifié → fixtures → snapshot intégral des treize tables → migrations 00000/00001/00002/00003 inchangées sous postgres → comparaison historique → permissions/suppressions → projets fictifs → suites Publications/Agent Scope → interactions → rollback complet → contrôle de base vide, sans fonctions métier ni ACL par défaut public restantes.

`psql -X --no-password -v ON_ERROR_STOP=1 -f` arrête au premier échec. Les NOTICE de cascade sont conservées dans la trace. Les destructions réussies sont annulées dans des sous-transactions. Le runner compare les compteurs, migrations appliquées et résultats des interactions entre les deux reconstructions.

## Rapport demandé

| Point | Résultat |
| --- | --- |
| 1. Fidélité | Définitions et ACL des catalogues métier comparées effectivement à l'instantané distant |
| 2. Limites | Infrastructure Supabase managée et paramètres système hors reproduction, détails ci-dessus |
| 3. Migration 00000 | Réussie, treize tables Publications et configuration sûre |
| 4. Migration 00001 | Réussie, triggers et RPC transactionnelles |
| 5. Migration 00002 | Réussie, scope et droits navigateur révoqués sur neuf tables |
| 6. Migration 00003 | Réussie, projet versionné et RPC de rattachement |
| 7. Audit TEXT | Les deux RPC agents écrivent les UUID sous leur forme textuelle exacte ; anciens identifiants non UUID conservés |
| 8. Suppression recommandation/action | Suppression recommandation liée refusée 55000 ; supprimer explicitement l'action puis sa recommandation reste autorisé |
| 9. Permissions après migrations | Révocations et droits conservés vérifiés privilège par privilège |
| 10. Permissions historiques larges | clients/client_services/client_connections/client_events pour anon/authenticated ; droits service_role historiques conservés |
| 11. TRUNCATE | Risques effectivement exercés, matrice détaillée ci-dessous |
| 12. Migration agents | Deux agents scope=client, scope_review_required=true ; aucune assignation projet créée |
| 13. Project scope | Autorisations, révocation, refus cross-client et project_id cohérents sur runs/recommandations/actions/messages réussis |
| 14. Publications | RLS/ACL, flags, slots/unicités/FK, idempotence, index, append-only, RPC, versions, project scope et rollback audit/job réussis |
| 15. Premier rebuild | 968 contrôles réussis, base vide vérifiée après rollback |
| 16. Second rebuild | 968 contrôles réussis, mêmes résultats, base vide vérifiée |
| 17. Lint | Réussi |
| 18. Typecheck | Réussi |
| 19. Build | Réussi, Next.js 16.3.8 |
| 20. Tests Node | 117 réussis, 0 échec, 0 ignoré : 114 application et 3 intégrations SQL |
| 21. Corrections nécessaires | Aucune correction démontrée des quatre migrations ; décisions sécurité/conservation à prendre avant distant |
| 22. Distant | Aucune modification, seulement lecture des catalogues |

Les treize snapshots historiques concordent après migration en excluant seulement les nouvelles colonnes attendues. Aucun project_id ni date inventé. Les sept nouvelles FK projet restent NOT VALID comme prévu ; aucune validation implicite revendiquée.

Les suites précédentes passent aussi : 213 contrôles Publications isolés et 350 sur l'ancienne baseline, chacune reconstruite deux fois. La reproduction fidèle compte 1 936 contrôles sur les deux reconstructions. Les trois intégrations SQL rejouent leurs reconstructions avec succès pendant npm test.

## Suppressions réellement exercées

| Opération après migration | Comportement |
| --- | --- |
| Recommandation liée à une action | Refus 55000 : lien immuable ; action et message restent intacts |
| Action puis recommandation | Autorisé ; message supprimé par cascade |
| Agent ayant une assignation projet même désactivée | Refus 23503 |
| Agent sans références | Suppression autorisée |
| Client avec historique Publications | Refus 23503 |
| Client sans Publications ni référence projet bloquante | Suppression autorisée avec cascade sur projet fictif |
| Projet assigné | Refus 23503 |
| Projet sans références | Suppression autorisée |
| Projet lié uniquement à une tâche | Suppression autorisée, tâche conservée avec project_id NULL |

Avant migration, supprimer une recommandation met bien actions.recommendation_id à NULL et supprime les messages par cascade ; supprimer l'agent assigné cascade son historique. Après migration, le nouveau guard d'action bloque le premier comportement. Le SET NULL historique des tâches reste opérationnel malgré la nouvelle FK composite RESTRICT ; sa postcondition est vérifiée.

## Permissions et TRUNCATE

Pour chaque table historique, SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN sont contrôlés séparément pour anon, authenticated et service_role.

| Tables | anon/authenticated après migrations | service_role |
| --- | --- | --- |
| projects, tasks, agents, agent_client_assignments, agent_runs, recommendations, actions, agent_messages, audit_logs | Tous ces droits retirés | Privilèges historiques larges conservés |
| clients, client_services, client_connections, client_events | Tous ces droits historiques conservés | Privilèges historiques conservés |
| Treize tables Publications | Aucun accès | Droits limités prévus, pas DELETE/TRUNCATE |
| agent_project_assignments | Aucun accès | SELECT/INSERT/UPDATE |

RLS reste activée sans policy. SELECT anon sur clients retourne zéro ligne et INSERT est refusé par RLS, malgré les grants. Les permissions historiques restantes n'ont pas été corrigées.

| TRUNCATE après migrations | Résultat SQL local réel |
| --- | --- |
| audit_logs, anon/authenticated | Refus 42501 |
| audit_logs, service_role | **Réussite** ; le trigger UPDATE/DELETE ne protège pas TRUNCATE |
| client_services/client_connections/client_events, anon/authenticated | **Réussite sur des tables non vides**, malgré RLS |
| clients, anon, sans CASCADE | Refus 0A000 : FK entrantes |
| clients CASCADE, anon/authenticated | Refus 42501 : permissions des tables dépendantes révoquées |
| clients CASCADE, propriétaire postgres | Refus 55000 : journal Publications immuable |
| agents, anon | Refus 42501 |
| agents CASCADE, service_role | Refus 42501 : TRUNCATE interdit sur agent_project_assignments |
| agent_runs, service_role | **Réussite**, historique supprimable |
| recommendations CASCADE, service_role | **Réussite**, efface recommandations/actions/messages en contournant les guards de lignes |
| agents CASCADE, propriétaire postgres | **Réussite**, efface historique et assignations |

Avant migration, les essais anon TRUNCATE audit_logs et clients CASCADE réussissent aussi. Ces observations concernent les privilèges SQL et ne prouvent pas une exposition de TRUNCATE par l'API REST Supabase.

## Reproduction et décisions avant distant

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-publications-local.ps1 -PostgresBin 'C:\Users\Adrien\Documents\Adrien\codev-os\.local\runtime\pgsql-runtime\pgsql\bin'
```

`npm run test:remote-schema:db` exige REMOTE_SCHEMA_TEST_DATABASE_URL vers une base locale vide remote_schema_test ; sans configuration il échoue explicitement. Hôtes distants, noms de base non dédiés et options URL sont refusés. Le script global crée les trois bases locales, exécute SQL avant les contrôles application et arrête PostgreSQL dans finally. Les valeurs application sont fictives, télémétrie désactivée, .env inchangé.

Trace : `.local/remote-replay-final.log`. Cluster final `.local/publications-postgres/9605ac67cc4349e1bdc24f32185fd8bb`, arrêté. Aucun processus postgres restant au contrôle final. Écoute uniquement sur 127.0.0.1, vérifiée par SQL.

Les quatre migrations n'ont pas été modifiées. Les inserts de test fournissent désormais les champs obligatoires distants ; les contrôles clients distinguent explicitement les ACL conservées. Un premier essai s'est arrêté sur un code 42501 de cascade non anticipé ; le test vérifie maintenant exactement ce refus, sans élargir de permission. Les deux reconstructions finales et toutes les validations passent.

Avant application distante : décider explicitement des suppressions recommandation/action et tâche/projet, de la conservation et du durcissement des ACL/TRUNCATE historiques. Une migration de sécurité séparée, à autoriser et tester, est recommandée. La portée des deux agents doit être revue manuellement ; scope_review_required n'arrête pas les agents client dans le code actuel.

Ordre futur : sauvegarde/restauration vérifiées → suspension des écritures concernées → préflight actualisé → 00000 → 00001 → 00002 → 00003 → contrôles non destructifs → code compatible et revue des scopes. Arrêt au premier échec. Aucun schéma historique, script de rebuild ou test destructif vers le distant.

**Aucun supabase link, db push, ALTER/INSERT/UPDATE/DELETE distant, changement RLS/ACL distant, publication réelle ou appel Meta/Google/OpenAI. Le seul accès distant a été la lecture des catalogues. Le Lot 2 n'a pas été commencé.**
