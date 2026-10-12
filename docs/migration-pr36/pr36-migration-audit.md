# PR #36 : audit de la migration `20261027000000_publications_client_setup.sql`

Date : 2026-10-12. Projet Supabase `codev-os` (ref `lehlbcnpufkllcykvtlg`), état de production lu en lecture seule. Rien n'a été appliqué ni modifié.

## Verdict

La migration est correcte et prête : **aucune correction n'est nécessaire**, donc aucun changement dans le dépôt.

Elle est identique sur les branches #36, #40 et #41 (md5 `e21029d6ddf4406a63534cc3367b3e6b`).

Le refus rencontré dans l'autre outil ne vient pas d'une erreur SQL. Le plus probable (déduction) est un filtre de sécurité de l'outil qui bloque les scripts contenant `CREATE FUNCTION`, `GRANT` ou `REVOKE`. La voie la plus simple est donc le SQL Editor de Supabase, avec les deux scripts ci-dessous.

## État réel de la production (vérifié)

- **#33 et #34 :** leurs migrations sont appliquées (`publications_unscheduled_drafts`, `publications_schedule_drafts`, `whatsapp_media_library`). Le texte enregistré dans l'historique est identique octet pour octet aux fichiers du dépôt (même md5).
- **#36 :** rien n'est encore en place. Les 5 colonnes et les 2 fonctions sont absentes.
- **Dépendances :** tout ce que la migration utilise existe déjà, à savoir `publications_private.project_publications_eligible(text)`, `public.publication_channel_save(uuid,text,boolean,uuid,text,text)`, `publication_events`, `projects` et `clients`.
- **Données :** `publication_client_settings` contient **0 ligne** (24 kB). Il y a 4 clients.
- **Interrupteurs globaux :** `emergency_stop = true`, et automatisation, génération et publication sont désactivées.
- **Historique Supabase :** il suit la convention du connecteur : version = horodatage de l'application, nom court, texte dans `statements`.

## Audit

| Point | Résultat |
| --- | --- |
| Opérations | Uniquement additives : un `ALTER TABLE ... ADD COLUMN` (5 colonnes) et 2 `CREATE FUNCTION` avec leurs droits. Aucun `DROP`, `UPDATE`, `DELETE` ni `TRUNCATE`. |
| Données existantes | Aucune ligne n'est modifiée. Les nouvelles colonnes prennent leur valeur par défaut. Le script vérifie que le contenu des colonnes existantes, les projets et les interrupteurs globaux sont inchangés. |
| Valeurs par défaut | `auto_prepare_enabled = false`, `media_reuse_allowed = false`, `prepare_lead_days = 3`, `media_reuse_after_days = 180`. `require_human_approval = true` est verrouillé par `CHECK (require_human_approval)` et ne peut jamais passer à `false`. |
| Verrouillage | `ADD COLUMN` avec des valeurs par défaut constantes ne réécrit pas la table (PostgreSQL 11 et plus). Le verrou exclusif sur `publication_client_settings` ne dure que quelques millisecondes, sur une table vide. Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application. |
| Fonctions | Toutes deux sont `SECURITY INVOKER` avec `search_path = pg_catalog`, et tous les objets sont qualifiés. Pas de SQL dynamique. Elles prennent un verrou transactionnel par client. |
| Droits | `EXECUTE` est retiré à `public`, `anon` et `authenticated` (Supabase les accorde par défaut sur les nouvelles fonctions), puis accordé à `service_role` seulement. Le navigateur ne peut donc rien appeler. |
| Validation des entrées | Acteur `^user_`. Liste fermée de clés, avec les types contrôlés. Brief limité à 10 000 caractères, sans caractères de contrôle. Fuseau horaire contrôlé par le déclencheur existant `publication_client_timezone`. Le journal d'audit ne recopie pas le texte du brief. |
| Publication automatique | La migration n'active rien. La préparation automatique reste désactivée pour tous les clients, et les interrupteurs globaux ne sont pas touchés. Le planificateur ne lit ces réglages qu'à partir de #39. |
| Création de projet | `publication_client_project_ensure` ne s'exécute que sur clic « Configurer les publications ». Elle réutilise le plus ancien projet éligible, sinon elle crée un projet et ses 3 canaux **désactivés**. Rien n'est créé au moment de la migration. |
| Compatibilité #33 et #34 | La migration ne redéfinit aucune fonction de #33 ni de #34. La RPC de #34 `publication_schedule_draft` et les fonctions qu'elle appelle restent inchangées. Leurs suites SQL passent après toute la chaîne de migrations (50/50 et 28/28). |

Remarque mineure, sans correction : une avance non entière (par exemple `3.5`) est refusée avec le code `22P02` au lieu de `22023`. L'écran n'envoie que des entiers.

## Les cinq migrations suivantes

À appliquer dans cet ordre, chacune avec sa PR et après la précédente :

| Migration | PR | Dépend de |
| --- | --- | --- |
| `20261028000000_media_library_intelligence` | #37 | `whatsapp_media_library` (déjà en production) |
| `20261029000000_publications_editorial_selection` | #38 | 20261027 (réglages client) et 20261028 (photothèque) |
| `20261030000000_publications_scheduled_flow` | #39 | 20261029 (contraintes des notifications) |
| `20261031000000_publications_supervision` | #40 | 20261030, et la chaîne de diffusion existante |
| `20261101000000_whatsapp_export_import` | #41 | 20261028 (origine `whatsapp_export`) |

Testé localement sur une réplique de la production (schéma de production, puis migrations jusqu'à 20261026, plus une ligne de réglages existante) :

1. le script d'application passe et laisse la ligne existante intacte ;
2. le script d'historique inscrit le bon texte (md5 vérifié) ;
3. un second passage de chacun des deux scripts est refusé ;
4. les 5 migrations suivantes s'appliquent ensuite sans erreur.

## Fichiers

- [20261027000000_apply_sql_editor.sql](20261027000000_apply_sql_editor.sql) : contrôles préalables, migration du dépôt **sans modification**, vérifications, puis compte rendu. Le tout dans une seule transaction.
- [20261027000000_sync_migration_history.sql](20261027000000_sync_migration_history.sql) : inscription dans l'historique. Le script refuse d'écrire si la migration n'est pas réellement en place ou si elle est déjà inscrite.

## Procédure dans Supabase

1. **Ouvrir le SQL Editor.** Supabase, projet `codev-os`, SQL Editor, « New query ».
2. **Appliquer.** Coller **tout** le contenu de `20261027000000_apply_sql_editor.sql`, puis « Run ». Supabase peut avertir d'une opération potentiellement destructive à cause de l'`ALTER TABLE` : la confirmer.
3. **Contrôler le résultat attendu :** un tableau de 4 lignes.
   - les 5 colonnes avec leurs valeurs par défaut ;
   - les 2 fonctions ;
   - `clients avec préparation automatique = 0` ;
   - `emergency_stop=true automation=false generation=false publishing=false`.
4. **En cas d'erreur.** Un message `ARRET : ...` ou `VERIFICATION : ...` signifie que rien n'a été appliqué. Ne pas continuer et me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `20261027000000_sync_migration_history.sql`, puis « Run ». Résultat attendu : une ligne `publications_client_setup` avec `md5_texte = e21029d6ddf4406a63534cc3367b3e6b`.
6. **Vérifications après coup**, en lecture seule, à tout moment :

```sql
select column_name, data_type, column_default from information_schema.columns
 where table_schema='public' and table_name='publication_client_settings' order by ordinal_position;
select p.oid::regprocedure, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
  from pg_proc p where p.proname in ('publication_client_settings_save','publication_client_project_ensure');
select count(*) filter (where auto_prepare_enabled) as auto_prepare, count(*) filter (where not require_human_approval) as sans_validation
  from public.publication_client_settings;
select * from public.publication_settings;
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
```

Attendu :
- `prosecdef = false`, `proconfig = {search_path=pg_catalog}`, `anon = false`, `service_role = true` ;
- 0 client en préparation automatique et 0 client sans validation ;
- `emergency_stop = true`.

## Ensuite : fusion de #36

Oui, #36 pourra être fusionnée une fois la migration appliquée et inscrite.

Elle est à jour avec master (0 commit de retard) et sans conflit, et typecheck, lint, tests et build passent.

**Appliquer la migration avant de fusionner.** La fusion déclenche le déploiement de production, et l'onglet Publications appelle les deux nouvelles fonctions.

Ensuite, même procédure pour chaque PR, dans l'ordre #37 à #41 : appliquer sa migration, puis fusionner.
