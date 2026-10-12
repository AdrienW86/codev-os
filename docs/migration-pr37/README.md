# PR #37 : migration `20261028000000_media_library_intelligence.sql`

Photothèque intelligente (profil média, classement ia, quarantaine). Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-12. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261028000000_media_library_intelligence.sql` (24206 octets, md5 `5cb30e1a24d0023a5d6669ddcc3c29ae`) |
| Nom dans l'historique | `media_library_intelligence` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `publications_client_setup` (#36) et `whatsapp_media_library`, déjà dans l'historique de production. |
| Contrôles après application | 44, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- 3 tables : `client_media_profiles` (profil média par client, classement IA **désactivé** par défaut, budget 2 €/mois), `whatsapp_asset_assessments` (évaluations), `client_media_ai_usage` (coûts IA).
- `whatsapp_assets` : colonnes `origin` (défaut `whatsapp`), `captured_at`, `purged_at`, `classification_failures` (0), `classification_failed_at` ; statuts `quarantined` et `rejected` ajoutés à la contrainte ; « rejeté » réservé à une décision humaine.
- 9 fonctions, dont l'enregistrement d'une évaluation (seule transition automatique : vers « à examiner » ou « quarantaine »), la décision humaine (qui annule aussi les diffusions non envoyées des publications utilisant une photo mise en quarantaine ou rejetée) et la purge des seuls rejets humains, si la politique du client le demande (par défaut : conserver).

**Données existantes** : Aucune ligne existante modifiée. Les 2 photos actuelles (statut `validated`) restent identiques ; elles reçoivent `origin = whatsapp`.

**Publication automatique** : la migration n'active rien. Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : `whatsapp_assets` : suppression puis recréation d'une contrainte CHECK et ajout de colonnes à valeur par défaut constante (sans réécriture). Verrou exclusif de quelques millisecondes sur une table de 2 lignes. Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application.

## Précautions particulières

- **RLS** : les 3 nouvelles tables ont la RLS active sans politique ; seul `service_role` y accède (le navigateur n'a aucun droit).
- **Fonctions** : toutes SECURITY INVOKER avec `search_path = pg_catalog` ; EXECUTE retiré à public, anon et authenticated.
- **Purge** : rien n'est supprimé par la base. Une photo n'est mise à la corbeille Drive que si un humain l'a rejetée, après la durée de conservation du client, et seulement si sa politique est `trash_drive` (par défaut `keep`). La corbeille Drive reste récupérable 30 jours.

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée, fonctions remplacées identiques à la version attendue), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Le texte officiel est transporté en base64 et son md5 contrôlé : un copier-coller qui change les fins de ligne (CRLF sous Windows) ou l'encodage ne peut plus l'altérer (cause de l'échec rencontré sur #36). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` à partir du fichier officiel ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de la PR précédente est appliquée et inscrite (voir l'ordre ci-dessous), et cette PR n'est **pas encore fusionnée** (la fusion déploie le code qui utilise ces objets).
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ». Supabase peut signaler une opération potentiellement destructive (à cause des `ALTER TABLE` ou `DROP CONSTRAINT` suivis de leur recréation) : confirmer.
3. **Résultat attendu** : une ligne `migration = 20261028000000 appliquée`, `controles_reussis = 44`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `media_library_intelligence` avec `md5_texte = 5cb30e1a24d0023a5d6669ddcc3c29ae`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #37 seulement ensuite.

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
