# Validation du dump existant — 5 octobre 2026

La restauration a réussi jusqu'au bout. L'archive existante `backups/pre-migration-2026-10-05/20261005T174418Z/public.dump` est validée pour la restauration du schéma public et des données métier qu'elle contient. Aucun nouveau dump créé, aucune modification de l'archive, aucune migration distante.

## Méthode et commandes réellement utilisées

Inspection du catalogue : l'archive contient explicitement `SCHEMA public`, ses ACL et propriétaires. Une nouvelle base locale `restore_test` a été créée depuis `template0` dans un cluster PostgreSQL 17.11 neuf. Le seul schéma `public` local vide a été supprimé sans CASCADE, puis recréé par l'archive. Aucun `--clean` sur des données existantes, aucune modification de la TOC.

Les commandes suivantes ont utilisé les exécutables de `.local/runtime/pgsql-runtime/pgsql/bin/`, avec `PGHOST=127.0.0.1`, `PGHOSTADDR=127.0.0.1`, `PGPORT=30039`, `PGUSER=backup_local`. Aucun mot de passe local et aucun secret dans les arguments.

```powershell
pg_restore.exe --list backups/pre-migration-2026-10-05/20261005T174418Z/public.dump
createdb.exe -w --template=template0 restore_test
psql.exe -X -w -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public;'
pg_restore.exe -w --exit-on-error --single-transaction --dbname=restore_test backups/pre-migration-2026-10-05/20261005T174418Z/public.dump
pg_restore.exe -w --exit-on-error --single-transaction --dbname=restore_test backups/pre-migration-2026-10-05/20261005T174418Z/migration-history.dump
```

Pour la commande DROP, `PGDATABASE=restore_test` était explicitement défini. Les rôles locaux requis par les ACL ont été créés sans mots de passe avant restauration. Aucun `--no-owner` ni `--no-acl` utilisé. Public et historique des migrations ont été restaurés avec code de sortie zéro.

Le script reproductible local est `scripts/verify-existing-backup.ps1`. Il ne se connecte pas au distant et ne lit aucun secret. Les métadonnées distantes comparées ont été récupérées séparément avec le connecteur Supabase dans une transaction READ ONLY. Les comparaisons portent sur le projet `codev-os`, référence `lehlbcnpufkllcykvtlg`.

## Résultats structurels

| Périmètre | Distant | Local | Comparaison |
| --- | ---: | ---: | --- |
| Tables public | 13 | 13 | Identique |
| Colonnes | 125 | 125 | Types, ordre, défauts et nullabilité identiques |
| Contraintes | 38 | 38 | Définitions identiques |
| Index | 39 | 39 | Définitions identiques |
| Fonctions publiques | 2 | 2 | Définitions et ACL identiques |
| Triggers métier | 8 | 8 | Définitions identiques |
| RLS active | 13/13 | 13/13 | Identique ; FORCE RLS désactivée |
| Policies public | 0 | 0 | Identique |

Les noms des tables, leurs propriétaires et ACL concordent aussi. Fonctions : `set_updated_at()` et `prevent_audit_log_mutation()`.

## Données

| Objet | Distant | Local |
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
| client_services | 0 | 0 |
| client_connections | 0 | 0 |
| client_events | 0 | 0 |

Des empreintes de toutes les lignes et colonnes, agrégées dans un ordre stable, concordent également pour les 13 tables. Aucune donnée métier brute affichée. Le premier calcul différait à cause de la représentation des timestamptz selon le fuseau de session ; après normalisation UTC des deux sessions, aucun écart dans les données ni dans les métadonnées.

## Preuves et limites

- Dump inchangé : 53 446 octets, SHA256 `754AE7BE04F419578EC90E9D5DB6F337CCD61CE0B7C9BF3082EBDE983C726915`.
- Archives et journaux ignorés par Git, jamais committés.
- Journaux de restauration et résultat JSON : `backups/pre-migration-2026-10-05/20261005T174418Z/restore-validation-0472994ecfea42d78b62f4ec7491275f/`.
- Cluster neuf confirmé en écoute uniquement sur 127.0.0.1, puis arrêté après validation.
- La récupération de public et de l'historique de migrations est démontrée en local. Cela ne constitue pas une sauvegarde des schémas administrés Auth/Storage/Vault, des objets Storage ou des secrets Supabase.
- Une restauration sur un distant déjà migré devra être autorisée et préparée séparément ; le dump ne supprime pas les nouveaux objets absents de l'archive et le replay dans public existant n'est pas une procédure inverse automatique.

Les cinq migrations 00000–00004 restent non appliquées. Aucun ALTER/INSERT/UPDATE/DELETE, changement RLS ou permissions distant. Aucune publication externe, aucun worker. Arrêt après validation.
