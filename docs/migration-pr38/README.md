# PR #38 : migration `20261029000000_publications_editorial_selection.sql`

Sélection éditoriale (sujet + photo de la photothèque, variantes par réseau). Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-12. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261029000000_publications_editorial_selection.sql` (28922 octets, md5 `12f7a2b7bb74f727b6540164632030e5`) |
| Nom dans l'historique | `publications_editorial_selection` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `media_library_intelligence` (#37) et `publications_client_setup` (#36). |
| Contrôles après application | 43, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- `publication_agent_v2_runs` : colonne `selected_library_asset_id` et contraintes associées ; `whatsapp_assets` : colonne `claimed_agent_v2_run_id` (réservation par un run).
- 3 fonctions de garde : photo publiable, réemploi permis, photo disponible pour le run.
- 6 fonctions de l'Agent Publications v2 **remplacées** (mêmes signatures) : finir, réserver, attacher, échouer, garde d'immuabilité, cible du média (désormais brouillons uniquement). Le script vérifie avant tout que leur version en production est exactement celle attendue (vérifié le 2026-10-12 en lecture seule : les 7 empreintes correspondent).
- Notifications : catégorie « Photo manquante » (`media_missing`).

**Données existantes** : Aucune ligne existante modifiée. La mise à jour des préférences de notification ajoute seulement `media_missing` aux préférences existantes (0 ligne en production aujourd'hui) ; le script le vérifie.

**Publication automatique** : la migration n'active rien. Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : Contraintes recréées sur `admin_notifications` (7 lignes), `admin_notification_preferences` (0 ligne) et `publication_agent_v2_runs` (0 ligne) ; clé étrangère ajoutée sur `whatsapp_assets` (2 lignes) ; 3 index créés sur des tables quasi vides. Quelques millisecondes. Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application.

## Précautions particulières

- **Fonctions remplacées** : si une seule diffère de la version attendue, le script s'arrête avant toute modification (« ARRET … différente de la version attendue »). Ne pas forcer : me transmettre le message.
- **Droits** : les fonctions remplacées gardent leurs droits ; les nouvelles fonctions privées sont réservées à `service_role`.

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée, fonctions remplacées identiques à la version attendue), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Le texte officiel est transporté en base64 et son md5 contrôlé : un copier-coller qui change les fins de ligne (CRLF sous Windows) ou l'encodage ne peut plus l'altérer (cause de l'échec rencontré sur #36). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` à partir du fichier officiel ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de la PR précédente est appliquée et inscrite (voir l'ordre ci-dessous), et cette PR n'est **pas encore fusionnée** (la fusion déploie le code qui utilise ces objets).
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ». Supabase peut signaler une opération potentiellement destructive (à cause des `ALTER TABLE` ou `DROP CONSTRAINT` suivis de leur recréation) : confirmer.
3. **Résultat attendu** : une ligne `migration = 20261029000000 appliquée`, `controles_reussis = 43`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `publications_editorial_selection` avec `md5_texte = 12f7a2b7bb74f727b6540164632030e5`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #38 seulement ensuite.

## Ordre de déploiement complet

| Étape | Migration | PR |
| --- | --- | --- |
| 1 | `20261028000000_media_library_intelligence` | #37 |
| 2 | `20261029000000_publications_editorial_selection` | #38 |
| 3 | `20261030000000_publications_scheduled_flow` | #39 |
| 4 | `20261031000000_publications_supervision` | #40 |
| 5 | `20261101000000_whatsapp_export_import` | #41 |

Pour chaque ligne : appliquer, inscrire, vérifier, puis fusionner la PR, avant de passer à la suivante.

## Tests réalisés

`node scripts/migration-kit.mjs --check` reconstruit en local une réplique de la production (schéma de production, migrations déjà appliquées, historique au format du projet, 4 clients, réglages, photothèque et notifications), puis pour chaque migration dans l'ordre :

- l'inscription est refusée tant que la migration n'est pas appliquée ;
- le script d'application passe, en fins de ligne LF **et** CRLF, et laisse les données existantes intactes ;
- l'inscription écrit le texte officiel (md5 contrôlé) ;
- `verify.sql` renvoie uniquement `true` ;
- une seconde application et une seconde inscription sont refusées.

Réplique locale en PostgreSQL 16 ; la production est en PostgreSQL 17 (les contrôles portent sur le code des fonctions, les droits et la présence des objets, identiques entre versions).
