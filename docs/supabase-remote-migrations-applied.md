# Application distante contrôlée — 5 octobre 2026

Projet unique : `codev-os` (`lehlbcnpufkllcykvtlg`). Les cinq fichiers validés ont été appliqués sans modification, dans l'ordre demandé, avec contrôles après chacun. La baseline historique n'a jamais été appliquée.

## 1. Précontrôle final

Comparaison structurelle et empreintes de toutes les données publiques identiques à la restauration locale validée. Comptages attendus confirmés ; run `completed`, action `executed`, aucune activité critique détectée. Aucun objet partiel ni nouvelle migration déjà enregistrée. Archive toujours présente, 53 446 octets, SHA256 `754AE7BE04F419578EC90E9D5DB6F337CCD61CE0B7C9BF3082EBDE983C726915`.

## 2–6. Résultat des migrations

Le connecteur `apply_migration` attribue la version d'enregistrement au moment de l'application. Les noms complets des fichiers locaux sont conservés dans les noms enregistrés ; les versions générées ci-dessous diffèrent donc des timestamps locaux. Aucun changement manuel de l'historique n'a été effectué. Une future utilisation de la CLI devra tenir compte de cette correspondance, pour éviter de rejouer les fichiers.

| Fichier local | Version distante | Résultat et contrôle immédiat |
| --- | --- | --- |
| 20261005000000_publications_schema.sql | 20261005181450 | Succès ; 13 tables Publications, RLS active, accès anon/authenticated retiré, settings présents, tous flags false, emergency_stop true ; 1 événement d'initialisation, aucun contenu. |
| 20261005000001_publications_transactions.sql | 20261005181530 | Succès ; 3 RPC Publications, permissions serveur, SECURITY INVOKER et search_path pg_catalog ; triggers events UPDATE/DELETE et TRUNCATE présents. |
| 20261005000002_agent_project_scope.sql | 20261005181551 | Succès ; colonnes agents ajoutées, 2 agents scope client/review true ; assignations projet vides, 4 project_id historiques NULL, tasks.completed_at ajouté. |
| 20261005000003_publications_project_scope.sql | 20261005181613 | Succès ; project_id sur publications/revisions, published_at sur deliveries ; 2 FK composites projet/client ON DELETE RESTRICT NOT VALID présentes ; aucune donnée de publication inventée. |
| 20261005000004_harden_historical_permissions.sql | 20261005181643 | Succès ; privilèges navigateur retirés sur les 27 tables, TRUNCATE service_role retiré partout, historique agentique protégé contre DELETE, audits/events append-only, aucune policy ajoutée. |

Toutes les migrations sont effectivement enregistrées sous le nom du fichier sans `.sql`. Les empreintes des colonnes historiques et les comptages ont été vérifiés après chaque migration et une dernière fois après les tests de lecture.

## 7. Objets créés/modifiés

13 tables Publications et `agent_project_assignments` ; schémas privés de helpers ; nouvelles colonnes, contraintes, index et triggers prévus par les cinq fichiers. Scope client/projet, rattachement Publications/projet, completed_at des tâches et published_at des livraisons installés. Les FK ajoutées NOT VALID le restent conformément aux fichiers validés ; elles contrôlent les nouvelles écritures sans prétendre avoir validé toutes les anciennes lignes.

## 8. Données conservées

| Table | Avant | Après |
| --- | ---: | ---: |
| clients | 2 | 2 |
| projects | 0 | 0 |
| tasks | 1 | 1 |
| agents | 2 | 2 |
| agent_client_assignments | 1 | 1 |
| agent_runs | 1 | 1 |
| recommendations | 1 | 1 |
| actions | 1 | 1 |
| agent_messages | 1 | 1 |
| audit_logs | 15 | 15 |

Toutes les valeurs des colonnes préexistantes concordent, vérifiées par empreintes stables en UTC. Les nouvelles colonnes seules portent le backfill prévu. Aucune assignation projet inventée, aucune suppression.

## 9. Permissions finales

Sur les 27 tables publiques applicatives, aucun privilège métier direct pour anon/authenticated, y compris TRUNCATE et MAINTAIN. service_role n'a TRUNCATE nulle part et conserve SELECT/INSERT partout ; les huit tables historiques modifiables conservent CRUD. DELETE retiré sur les quatre historiques agentiques ; audit_logs et les cinq historiques Publications conservent uniquement SELECT/INSERT parmi les droits DML. Triggers audit_logs UPDATE/DELETE et publication_events UPDATE/DELETE/TRUNCATE vérifiés, quatre triggers de conservation d'historique agentique présents.

Limite prévue par la migration validée : les defaults du créateur `postgres` sont durcis ; ceux du rôle administré `supabase_admin` restent inchangés, car postgres n'est pas membre de ce rôle. Les tables actuelles sont toutes durcies. Ne pas assimiler cette limite aux permissions actuelles et ne pas créer de nouvelles tables applicatives comme supabase_admin sans revue explicite.

## 10. RLS finale

Active sur 27/27 tables applicatives, aucune policy publique. Les checks des privilèges effectifs anon/authenticated et service_role ont été réalisés dans le catalogue, sans essai destructif distant.

## 11. RPC finales

Sept nouvelles RPC : publication_create_manual, publication_revise_manual, publication_review, agent_set_scope, agent_project_assignment_set, publication_set_project, publication_create_project_manual. EXECUTE service_role confirmé, EXECUTE anon/authenticated refusé ; SECURITY INVOKER, search_path explicite pg_catalog. Les deux fonctions historiques restent disponibles pour le backend.

Les RPC mutantes n'ont pas été invoquées sur le distant pour créer des données de test. Leur comportement transactionnel était validé localement ; la présence, définition et permissions sont vérifiées sur le distant. Aucun nouveau test de mutation/rollback distant n'est revendiqué.

## 12. Agents à revoir

| Nom | ID | État |
| --- | --- | --- |
| Agent Ads | 8de14282-943f-478b-83ca-8f156d4d7b0b | agent_scope=client ; scope_review_required=true |
| teds | 3ab37d17-a536-428f-a132-0f9980d31cf0 | agent_scope=client ; scope_review_required=true |

Aucune confirmation de scope automatique, aucune activation ou désactivation supplémentaire.

## 13–14. Publications et arrêt général

0 publication, 0 job, 0 livraison ; 1 événement d'initialisation. generation_enabled=false, automation_enabled=false, publishing_enabled=false, emergency_stop=true. Aucune activation par client ou plateforme.

## 15. Validation application

Ancien serveur Next.js du dépôt identifié et arrêté, puis CODE-V OS relancé sur `http://127.0.0.1:3000`, avec `.env` existant et le projet distant migré. Aucun worker/cron lancé.

Les sélections et jointures réellement utilisées dans les modules de lecture clients/projects/tasks/agents/recommendations/actions/agent-runs/publications ont été exécutées avec le SDK Supabase et la clé serveur existante : toutes réussissent, sans donnée brute ni secret affiché. La lecture settings réussit et confirme les flags sûrs. Cela couvre les sources de données du dashboard et des sept domaines listés.

GET des huit routes dashboard/clients/projects/tasks/agents/recommendations/actions/publications : 307 vers sign-in, conformément à la protection Clerk sans session. Aucun outil de navigateur authentifié disponible ici : le rendu et les interactions de l'interface administrateur après connexion ne sont pas validés. Aucun contournement d'authentification ou création de session Clerk. La validation backend et la protection HTTP sont réussies ; la validation visuelle authentifiée reste à faire.

Aucune mutation applicative nécessaire ni exécutée. Les suites locales lint/typecheck/build/tests déjà validées n'ont pas été relancées pour cette opération exclusivement de migration distante.

## 16. Incidents / limites

Aucun échec de migration ou de contrôle DB. Le premier démarrage Next a signalé le serveur déjà actif ; celui-ci a été identifié puis redémarré. Versions de migration générées par le connecteur, defaults supabase_admin inchangés et absence de session de test authentifiée documentés ci-dessus. Aucun correctif SQL improvisé.

## 17. Confirmation et arrêt

Aucune publication externe, aucun Meta/GBP, Google Ads mutate, email, worker ou cron. Aucun changement Clerk, Airtable ou Make, aucun secret affiché, aucun db push, aucune baseline distante. Les seules mutations distantes sont les cinq migrations autorisées. Le serveur local reste disponible pour la revue administrateur. Aucun Lot 2 commencé.
