# Sauvegarde manuelle distante — 5 octobre 2026

Ce rapport décrit l'essai initial. La reprise autorisée a depuis réussi : voir [la validation réelle de restauration](supabase-backup-restoration-validation.md), qui remplace le statut d'échec ci-dessous.

Statut : dump créé, restauration locale échouée, arrêt demandé respecté. La sauvegarde n'est PAS validée comme restaurable. Aucune migration distante n'est autorisée par ce résultat.

## Fichiers et périmètre

Dossier ignoré par Git : `backups/pre-migration-2026-10-05/20261005T174418Z/`.

- `public.dump` : 53 446 octets, format PostgreSQL custom, créé avec pg_dump 17.11, SHA256 `754AE7BE04F419578EC90E9D5DB6F337CCD61CE0B7C9BF3082EBDE983C726915`.
- `migration-history.dump` : 5 197 octets, archive séparée du schéma `supabase_migrations`, pour préserver l'historique de migration.
- `archive-list.txt` : lecture réelle réussie avec `pg_restore --list public.dump`.
- `remote-before.json`, `remote-after.json` : comptages et métadonnées, identiques avant/après export.
- `restore.log` : échec local conservé. `stop.log` : arrêt du cluster local confirmé.

L'archive publique inclut schéma, tables, données, fonctions, triggers, contraintes, index, RLS et ACL/propriétaires (aucun `--no-acl` ni `--no-owner`). Le dump utilise `--schema=public`; ce n'est pas une sauvegarde complète de tous les schémas administrés Supabase, ni des objets Storage. Aucun export des mots de passe de rôles, clés API, Vault ou configuration de secrets. Les données métier peuvent contenir des informations sensibles : ne pas committer, afficher ou partager les archives. `/backups/` est ignoré par Git.

Connexion SSL PostgreSQL au projet approuvé `codev-os`, uniquement en lecture, avec `PGOPTIONS=-c default_transaction_read_only=on`. Mot de passe encodé dans `.env`, utilisé via variable de processus et jamais affiché ni passé en argument de commande. Aucun changement distant.

## Restauration réellement tentée

Cluster PostgreSQL 17.11 neuf, écoute uniquement `127.0.0.1`, base `restore_test` créée depuis `template0`. Rôles locaux sans mots de passe préparés pour les ACL (`postgres`, `anon`, `authenticated`, `service_role`, `supabase_admin`).

Commande locale exécutée :

```powershell
pg_restore --no-password --exit-on-error --single-transaction --dbname=restore_test public.dump
```

Échec : `ERROR: schema "public" already exists`. Une base fraîche PostgreSQL contient déjà ce schéma ; l'archive exportée demande de le créer. Le problème est dans la préparation de la destination locale, sans preuve actuelle d'un défaut dans les données de l'archive.

La restauration s'exécute en transaction unique : cet essai n'a pas restauré les données. Aucun nouvel essai après cet échec, conformément à l'instruction utilisateur. Le cluster temporaire a été arrêté. L'export antérieur `20261005T174200Z` a été conservé ; sa tentative a été interrompue avant restauration à cause de la gestion du processus local. Le script `scripts/backup-supabase-local.ps1` n'est pas validé comme procédure complète et ne doit pas être considéré comme prêt pour une reprise automatique.

## Comptages distants constatés

| Objet | Distant avant/après | Local restauré |
| --- | ---: | --- |
| Tables métier | 13 | Non validé |
| clients | 2 | Non validé |
| projects | 0 | Non validé |
| tasks | 1 | Non validé |
| agents | 2 | Non validé |
| agent_client_assignments | 1 | Non validé |
| agent_runs | 1 | Non validé |
| recommendations | 1 | Non validé |
| actions | 1 | Non validé |
| agent_messages | 1 | Non validé |
| audit_logs | 15 | Non validé |
| client_services/client_connections/client_events | 0 chacun | Non validé |
| Fonctions publiques | 2 | Non validé |
| Triggers métier | 8 | Non validé |

Fonctions : `set_updated_at`, `prevent_audit_log_mutation`. Aucune comparaison locale réussie revendiquée ; aucune donnée distante n'a été supprimée ou modifiée.

## Procédure de restauration : à valider avant tout incident distant

La prochaine reprise doit être autorisée et rester locale. Dans une nouvelle base temporaire sans données, préparer les rôles requis et supprimer uniquement son schéma `public` vide avant de rejouer l'archive :

```powershell
# Toutes les variables PG* doivent désigner explicitement le cluster LOCAL.
psql -X --no-password -v ON_ERROR_STOP=1 -d restore_test -c 'DROP SCHEMA public;'
pg_restore --no-password --exit-on-error --single-transaction --dbname=restore_test public.dump
pg_restore --no-password --exit-on-error --single-transaction --dbname=restore_test migration-history.dump
```

Ce correctif n'a PAS été exécuté. Il reste à valider la restauration, les comptages, métadonnées et les données, puis arrêter le cluster. Aucun `DROP SCHEMA` distant n'est proposé ni autorisé.

En cas d'incident distant, une procédure exécutable complète ne peut pas encore être garantie. Elle nécessitera : arrêt des écritures et workers, inventaire des migrations/écritures depuis ce dump, récupération validée dans une cible isolée, stratégie explicitement approuvée de remise en place du schéma public et de l'historique de migrations, puis contrôles métier/RLS/ACL/RPC et réouverture. Restaurer dans le public existant avec `--clean` peut supprimer des objets et données ; une migration 00000–00004 déjà appliquée crée aussi des objets absents de cette archive. Le dump ne supprime pas automatiquement ces nouveaux objets. Ne pas improviser un rollback ou lancer `pg_restore --clean` sur le distant.

Conclusion : conserver les archives, ne pas appliquer les migrations. Aucune publication externe, aucun worker, aucune modification Clerk/Airtable/Make, aucun `supabase link` ni `db push`.
