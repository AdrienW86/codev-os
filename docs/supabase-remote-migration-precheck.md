# Précontrôle de migration distante — 5 octobre 2026

## Décision

ARRÊT avant toute mutation. Le schéma et les données critiques passent les contrôles, mais une sauvegarde exploitable et un point de restauration ne peuvent pas être confirmés avec les accès disponibles. L'autorisation donnée exige explicitement cet arrêt. Aucune des migrations 20261005000000–20261005000004 n'a été appliquée.

## Projet et contrôles réellement exécutés

Cible unique : `codev-os`, référence `lehlbcnpufkllcykvtlg`, région `eu-west-3`, état `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.002`.

Les inspections SQL ont été exécutées dans des transactions `BEGIN READ ONLY … ROLLBACK`. Aucun appel à `apply_migration`, aucune écriture métier, aucun changement de permission ou RLS, aucun démarrage de worker.

Comparaison complète du périmètre historique du snapshot `supabase/local/remote-schema-snapshot.json`, lu explicitement en UTF-8 : aucune différence dans les tables, colonnes, types, valeurs par défaut, nullabilité, contraintes, index, RLS, propriétaires, ACL, fonctions, triggers, policies ou privilèges par défaut du schéma public. Les ordres des tableaux du catalogue sont neutralisés pour la comparaison.

Inventaire : 13 tables, 125 colonnes, 38 contraintes, 39 index, 8 triggers non internes, 2 fonctions publiques et 6 entrées de privilèges par défaut publics. RLS active sur les 13 tables, FORCE RLS désactivée, aucune policy. Aucun ACL de colonne, aucune vue, vue matérialisée, table étrangère/partitionnée, séquence publique, enum ou domaine public détecté.

Seules les migrations historiques `20261002205340 initial_codev_os_schema` et `20261002205358 harden_initial_schema` sont enregistrées. Aucune des cinq nouvelles migrations n'est enregistrée. Aucun schéma privé Publications/Agent Scope, aucune relation Publications/Agent Project Assignment et aucune des nouvelles colonnes métier détectés : aucun déploiement partiel identifié.

Les contrôles de contexte tâche/projet, action/recommendation, message/recommendation et runs sans client retournent tous zéro anomalie. Le run unique est `completed`, l'action unique est `executed`.

## Comptages actuels

| Table | Lignes |
| --- | ---: |
| clients | 2 |
| projects | 0 |
| tasks | 1 |
| agents | 2 |
| agent_client_assignments | 1 |
| agent_runs | 1 |
| recommendations | 1 |
| actions | 1 |
| agent_messages | 1 |
| audit_logs | 15 |
| client_services | 0 |
| client_connections | 0 |
| client_events | 0 |

Ces comptages correspondent aux valeurs attendues. Aucune mutation n'ayant été effectuée, aucun contrôle de conservation après migration n'est revendiqué.

## Sauvegarde : contrôle non satisfait

Le détail du projet fourni par le connecteur ne comporte aucun identifiant, statut, date ou intervalle PITR de sauvegarde. Aucun outil de listing des sauvegardes n'est exposé. La CLI Supabase est absente et aucun `SUPABASE_ACCESS_TOKEN` n'est présent dans l'environnement du processus. Les secrets du fichier `.env` n'ont pas été lus ou modifiés pour chercher un contournement. Aucun appel de restauration n'a été effectué.

Il est donc impossible ici de confirmer l'existence, la fraîcheur, l'exploitabilité ou les droits de restauration d'une sauvegarde. Cela ne démontre pas son absence. Le snapshot de schéma et les fixtures locales ne constituent pas une sauvegarde des données distantes.

La documentation officielle décrit le listing via le Dashboard Database > Backups et via le GET Management API `/v1/projects/{ref}/database/backups`. Les sauvegardes automatiques dépendent de l'offre ; leur existence n'est pas déduite du seul statut sain du projet.

Source : https://supabase.com/docs/guides/platform/backups

## Procédure de reprise et restauration

1. Sur la cible exacte, vérifier en lecture dans Database > Backups ou dans le listing Management API un backup terminé ou une plage PITR utilisable. Consigner son identifiant/date UTC, son état, la couverture temporelle, les droits de restauration et les données potentiellement perdues entre ce point et le démarrage des migrations. Un point trop ancien sans couverture des écritures récentes ne suffit pas à garantir leur conservation.
2. Confirmer les possibilités de restauration et, idéalement, éprouver la récupération dans un environnement isolé autorisé. Ne lancer aucune restauration distante pour la seule vérification.
3. Prévoir une fenêtre sans écritures applicatives ni workers, avec interruption possible. Refaire l'intégralité des précontrôles immédiatement avant application ; le résultat de ce rapport ne vaut pas contrôle permanent.
4. Appliquer uniquement les cinq fichiers validés, dans l'ordre 00000, 00001, 00002, 00003, 00004, avec les contrôles intermédiaires demandés. Ne jamais appliquer la baseline historique au distant. Arrêter au premier échec et conserver l'état exact des migrations déjà validées.
5. En cas d'incident, arrêter les écritures et inventorier les migrations effectivement enregistrées, les objets présents et les données créées depuis le point sauvegardé. Ne pas supprimer automatiquement les nouveaux objets ou l'historique et ne pas improviser de migration inverse.
6. Si une restauration est nécessaire, obtenir l'autorisation spécifique à cette opération destructive, puis utiliser la restauration Dashboard du backup identifié ou la restauration PITR au point UTC couvert. La restauration rend le projet indisponible et ramène toute la base au point sélectionné : les écritures ultérieures peuvent être perdues. Les objets Storage ne sont pas sauvegardés par les backups de base ; les mots de passe des rôles personnalisés et les slots de réplication personnalisés demandent une revue conformément à la documentation.
7. Après récupération, vérifier schéma, historique des migrations, comptages et données métier, RLS, permissions, fonctions, triggers et lectures applicatives avant réouverture. Revoir séparément les écritures à réconcilier. Ne reprendre aucune publication externe automatiquement.

Un rollback de la transaction courante ne retire pas les migrations précédentes déjà commitées. Les cinq migrations ne forment pas un rollback global automatique ; une restauration complète ne peut pas être promise sans point de récupération confirmé.

## Rapport des 18 points demandés

| Point | Résultat |
| --- | --- |
| 1. Precheck | Schéma, données, absence d'activité et absence de déploiement partiel conformes ; condition sauvegarde non satisfaite. |
| 2. Sauvegarde/restauration | Non confirmée avec les accès disponibles ; arrêt obligatoire. |
| 3. Migration 00000 | Non appliquée. |
| 4. Migration 00001 | Non appliquée. |
| 5. Migration 00002 | Non appliquée. |
| 6. Migration 00003 | Non appliquée. |
| 7. Migration 00004 | Non appliquée. |
| 8. Contrôles intermédiaires | Non exécutés : aucune migration appliquée. |
| 9. Historique | Comptages attendus confirmés ; aucune suppression ou écriture effectuée. |
| 10. Permissions finales | Inchangées. Les 13 tables conservent leurs ACL historiques larges pour anon/authenticated/service_role, dont TRUNCATE. Le durcissement 00004 reste à appliquer. |
| 11. RLS finale | Inchangée : active sur 13/13 tables, aucune policy. Les privilèges historiques TRUNCATE ne sont pas protégés par RLS. |
| 12. RPC finales | Les RPC nouvelles sont absentes. Les deux fonctions historiques et leurs permissions sont inchangées. |
| 13. Agents à revoir | Agent Ads et teds identifiés ci-dessous ; backfill scope/client/review non exécuté. |
| 14. Publications | Module absent du schéma distant. Aucun contenu créé. |
| 15. Kill switch | Paramètre DB Publications absent ; les valeurs sûres prévues par 00000 ne sont pas encore installées. Aucune activation effectuée. |
| 16. Tests application post-migration | Non exécutés : étape conditionnée au succès des migrations distantes. Aucune relance contre le distant. |
| 17. Incidents | Aucun incident distant. Blocage de vérification de sauvegarde. |
| 18. Publications externes | Aucune publication, aucun appel Meta/GBP, email ou Google Ads mutate. Aucun changement Clerk, Airtable ou Make. |

Agents identifiés pour la future revue manuelle :

| Nom | ID |
| --- | --- |
| Agent Ads | `8de14282-943f-478b-83ca-8f156d4d7b0b` |
| teds | `3ab37d17-a536-428f-a132-0f9980d31cf0` |

Aucun projet Supabase distant n'a été modifié. Aucun secret affiché. Aucun `supabase link`, `db push`, baseline distante ou Lot 2.
