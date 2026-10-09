# Validation locale du Lot 1 Publications

Ce rapport conserve la validation initiale. Le runner inclut désormais une troisième base pour la [reproduction fidèle du schéma distant](supabase-remote-replay-validation.md), avec 117 tests Node réussis et des contrôles complémentaires.

Validation initiale réalisée le 5 octobre 2026 sur PostgreSQL portable Windows **17.11**. Les deux reconstructions complètes et tous les contrôles réussissent. Aucun projet Supabase distant n'avait été consulté ou modifié lors de cette validation initiale. Le Lot 2 n'est pas commencé.

## Runtime et isolation

Source : [binaires PostgreSQL EDB](https://www.enterprisedb.com/download-postgresql-binaries), archive Windows 17.11 : https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616.

SHA256 : `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`.

Binaires dans `.local/runtime/pgsql-runtime/pgsql/bin`, ignorés par Git. Aucun service Windows installé. Seul le téléchargement du runtime a nécessité une connexion externe.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-publications-local.ps1 -PostgresBin 'C:\Users\Adrien\Documents\Adrien\codev-os\.local\runtime\pgsql-runtime\pgsql\bin'
```

Le script crée un cluster neuf, choisit un port libre, démarre uniquement sur `127.0.0.1` et vérifie réellement l'adresse d'écoute par SQL. Bases dédiées : `publications_lot1_test` et `agent_scope_test`. Authentification locale trust, aucune donnée réelle. Les paramètres libpq hérités sont neutralisés, sans utilisation de credentials distants.

Après les tests SQL, le script lance lint, typecheck, build et tous les tests. Des valeurs fictives de processus remplacent la configuration Supabase/Clerk/Google Ads ; `.env` n'est pas modifié. Les tests application utilisent des doubles de Clerk/Supabase. Télémétrie Next et Clerk désactivée. Le cluster est arrêté dans `finally`, même en cas d'échec ; les variables de processus sont restaurées.

## Baseline et migrations

`supabase/local/baseline.sql` reconstruit les douze tables historiques d'après les types et requêtes du dépôt. Elle est versionnée, réservée aux tests locaux et séparée des migrations de production. Les defaults et politiques inconnus du schéma distant ne sont pas certifiés : aucune inspection distante effectuée. La reconstruction vérifie le contrat local connu, sans certifier l'identité avec un schéma de production non fourni.

Ordre réellement exécuté sur base vide :

1. Bootstrap des rôles, baseline, données historiques entièrement fictives.
2. `20261005000000_publications_schema.sql`.
3. `20261005000001_publications_transactions.sql`.
4. Snapshot intégral des 25 tables historiques + Publications avec une publication synthétique déjà approuvée.
5. `20261005000002_agent_project_scope.sql`.
6. `20261005000003_publications_project_scope.sql`.
7. Conservation historique, suites `publications.sql` puis `agent-scope.sql`.
8. Rollback du schéma complet, vérification effective d'une base vide, puis seconde reconstruction identique.

Les snapshots comparent toutes les colonnes préexistantes et les nombres de lignes. Seules les colonnes ajoutées sont exclues ; les nouveaux project_id historiques restent NULL, sans attribution inventée. 31 contrôles de conservation exécutés.

`supabase/config.toml` est minimal, sans lien distant. CLI Supabase et Docker ne sont pas utilisés ni validés par cette méthode native.

## Résultats

| Vérification | Résultat |
| --- | --- |
| Première reconstruction baseline + quatre migrations | 350 contrôles SQL réussis, retour à une base vide vérifié |
| Deuxième reconstruction complète | 350 contrôles SQL réussis, retour à une base vide vérifié |
| Publications isolées, deux reconstructions | 213 contrôles réussis par reconstruction |
| SQL avant application | 1 126 contrôles, aucun échec |
| SQL relancé par npm test | Les mêmes reconstructions passent à nouveau |
| npm run lint | Réussi |
| npm run typecheck | Réussi |
| npm run build | Réussi, Next.js 16.3.8 |
| npm test | 116 réussis, 0 échec, 0 ignoré : 114 application + 2 intégrations SQL |
| Arrêt du cluster | Confirmé |

Trace : `.local/validation-final.log`. Cluster final : `.local/publications-postgres/03cc02e2aad34c0ea9e3c29ce40dc542`, arrêté.

## Garanties et corrections

Treize tables Publications, RLS, absence de policies permissives, retrait des privilèges anon/authenticated, refus effectifs de lecture/écriture, permissions serveur et RPC invoker avec search_path explicite vérifiés. Génération/automatisation/publication false et emergency_stop true. Slots, unicités, FK, plateformes, protections cross-client, idempotence, index jobs/deliveries/events, suppression client bloquée et événements append-only, UPDATE/DELETE/TRUNCATE refusés.

Portées client/projet, agent_project_assignments, project_id sur runs/recommandations/actions/messages/publications, autorisations et révocation, revalidation à chaque révision, approbation liée à la bonne révision et historique immuable exercés réellement.

Les injections d'échec d'audit et de job prouvent l'absence d'état partiel pour création/revue Publications, changement de projet, scope agent et assignations. Défaut réel corrigé dans publication_set_project sous contraintes immédiates : nouvelle révision créée avec le projet cible, puis projet et révision courante du parent changés ensemble. Tests positifs SET CONSTRAINTS ALL IMMEDIATE et retour à un projet NULL réussis, anciennes approbations non héritées.

Runner psql corrigé : fichier SQL UTF-8 et ON_ERROR_STOP évitent les problèmes Windows de gros scripts sur stdin. Artefacts `.local/**` exclus d'ESLint. Tests plateforme/cross-client corrigés pour empêcher une collision d'unicité de masquer la FK attendue.

PostgreSQL natif avec rôles Supabase locaux : services API/Auth/Storage et concurrence entre sessions non validés. Aucun bucket, connecteur, worker ni publication réelle créé. Aucun supabase link, db push, migration distante ou credential distant utilisé.
