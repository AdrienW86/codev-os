# PR #43 : migration `20261103000000_media_library_tools.sql`

Outils de la photothèque (recherche filtrée côté serveur, « Pourquoi écartée ? », reclassement, légende, historique d'utilisation, mémoire de la synchronisation Drive). Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-13. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261103000000_media_library_tools.sql` (16589 octets, md5 `93b8a2033773f0fb807801c06c48d375`) |
| Nom dans l'historique | `media_library_tools` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `whatsapp_export_import` (#41), donc toute la pile #37 → #41 déjà appliquée dans l'ordre. |
| Contrôles après application | 31, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- `whatsapp_assets` : deux colonnes facultatives `caption_edited_by` / `caption_edited_at` (légende modifiée par un administrateur) et un index `(client_id, sha256)` pour le dédoublonnage à l'échelle du client. Aucune ligne existante n'est modifiée.
- Table `whatsapp_asset_decisions` (ajout seul, RLS active sans politique) : historique des décisions humaines (statut, reclassement avec motif, légende modifiée). Alimentée par le déclencheur `whatsapp_asset_decision_log` (tout changement de statut posé par une personne) et par les deux RPC ci-dessous.
- RPC `whatsapp_asset_reclassify` (motif obligatoire ; réutilise `whatsapp_assets_review`, donc le verdict manuel, l'annulation des diffusions non envoyées et l'audit existants) et `whatsapp_asset_caption_save`.
- RPC de lecture `whatsapp_library_search` (filtres et pagination côté serveur) et `whatsapp_asset_usage_history` (historique d'utilisation partagé).
- Tables `client_media_drive_files` (doublons et échecs de lecture déjà examinés) et `client_media_drive_sync` (curseur de reprise des dossiers volumineux, rotation du planificateur), RLS active sans politique.
- Toutes les fonctions sont `SECURITY INVOKER`, `search_path = pg_catalog`, exécutables par `service_role` uniquement.

**Données existantes** : aucune ligne existante modifiée (contrôlé à la fin : aucune légende marquée éditée, aucune décision, aucune mémoire Drive). Aucune fonction existante n'est remplacée ; les règles de sélection de l'agent (`publications_private.library_asset_publishable`, `library_asset_reusable`, `agent_v2_library_available`) sont seulement lues.

**Publication automatique** : la migration n'active rien. Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : `ALTER TABLE whatsapp_assets` (ajout de deux colonnes nullables sans valeur par défaut, contrainte et index) et création d'un déclencheur : verrou bref sur `whatsapp_assets`. Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application.

## Précautions particulières

- **Déclencheur** : `whatsapp_asset_decision_log` s'exécute après chaque changement de `library_status` ; il n'écrit que pour une personne (`status_changed_by` de la forme `user_…`). Les transitions de l'analyse automatique ne sont pas historisées comme décisions humaines.
- **Suppression** : la politique de suppression des photos est inchangée (jamais de suppression ; corbeille Drive uniquement par la purge existante des photos rejetées).

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée, objets absents), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Le texte officiel est transporté en base64 et son md5 contrôlé (fins de ligne CRLF ou encodage sans effet). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` à partir du fichier officiel ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de la PR #41 est appliquée et inscrite, et cette PR n'est **pas encore fusionnée** (la fusion déploie le code qui utilise ces objets ; avant la migration, la photothèque revient d'elle-même à la liste historique sans filtres avancés).
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ». Supabase peut signaler une opération potentiellement destructive (à cause des `ALTER TABLE`) : confirmer.
3. **Résultat attendu** : une ligne `migration = 20261103000000 appliquée`, `controles_reussis = 31`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `media_library_tools` avec `md5_texte = 93b8a2033773f0fb807801c06c48d375`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #43 seulement ensuite.

## Ordre de déploiement complet

| Étape | Migration | PR |
| --- | --- | --- |
| 1 | `20261028000000_media_library_intelligence` | #37 |
| 2 | `20261029000000_publications_editorial_selection` | #38 |
| 3 | `20261030000000_publications_scheduled_flow` | #39 |
| 4 | `20261031000000_publications_supervision` | #40 |
| 5 | `20261101000000_whatsapp_export_import` | #41 |
| 6 | `20261103000000_media_library_tools` | #43 |

Les migrations des PR #42 et #44, si elles existent, s'intercalent selon leur horodatage : respecter l'ordre croissant des versions. Pour chaque ligne : appliquer, inscrire, vérifier, puis fusionner la PR, avant de passer à la suivante.

## Tests réalisés

`node scripts/migration-kit.mjs --check 43` reconstruit en local une réplique de la production (schéma de production, migrations déjà appliquées, historique au format du projet, 4 clients, réglages, photothèque et notifications), puis :

- l'inscription est refusée tant que la migration n'est pas appliquée ;
- le script d'application passe, en fins de ligne LF **et** CRLF, et laisse les données existantes intactes ;
- l'inscription écrit le texte officiel (md5 contrôlé) ;
- `verify.sql` renvoie uniquement `true` (33 vérifications) ;
- une seconde application et une seconde inscription sont refusées.

La suite `supabase/tests/publications-socle-6-media-library-tools.sql` (110 vérifications, deux reconstructions complètes de la chaîne) est exécutée par `tests/publications-socle-db.test.mjs`. Réplique locale en PostgreSQL 16 ; la production est en PostgreSQL 17.
