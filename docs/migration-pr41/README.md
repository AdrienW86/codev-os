# PR #41 : migration `20261101000000_whatsapp_export_import.sql`

Import d'archives de conversations whatsapp. Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-12. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261101000000_whatsapp_export_import.sql` (5531 octets, md5 `2070fedbbc2cfd339544e330a0540411`) |
| Nom dans l'historique | `whatsapp_export_import` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `media_library_intelligence` (#37) et `publications_supervision` (#40, pour respecter l'ordre de fusion). |
| Contrôles après application | 13, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- Bucket Storage **privé** `whatsapp-exports` (500 Mo maximum par archive), sans aucune politique : seul le serveur y accède, par URL signées de 15 minutes.
- Tables `whatsapp_export_imports` et `whatsapp_export_items` (RLS active sans politique), index dont `whatsapp_export_imports_one_active` (un seul import en cours par client) et 2 déclencheurs `updated_at`.
- La conversation n'est jamais stockée : seules les photos retenues, leur date et la légende de leur propre message ; légendes effacées et archive supprimée à la fin, à l'annulation ou après 24 h.

**Données existantes** : Aucune ligne existante modifiée.

**Publication automatique** : la migration n'active rien. Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : Aucun verrou sur une table existante (nouvelles tables, insertion d'un bucket). Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application.

## Précautions particulières

- **Storage** : le script s'arrête si un bucket `whatsapp-exports` existe déjà. Ne pas créer le bucket à la main avant.
- **RLS Storage** : aucune politique ne doit mentionner `whatsapp-exports` (contrôlé à la fin).
- **Conservation** : la purge est la première étape de la tâche planifiée (`whatsapp_exports`), isolée des autres ; un balayage supprime aussi les fichiers orphelins de plus de 24 h.

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée, fonctions remplacées identiques à la version attendue), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Le texte officiel est transporté en base64 et son md5 contrôlé : un copier-coller qui change les fins de ligne (CRLF sous Windows) ou l'encodage ne peut plus l'altérer (cause de l'échec rencontré sur #36). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` à partir du fichier officiel ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de la PR précédente est appliquée et inscrite (voir l'ordre ci-dessous), et cette PR n'est **pas encore fusionnée** (la fusion déploie le code qui utilise ces objets).
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ». Supabase peut signaler une opération potentiellement destructive (à cause des `ALTER TABLE` ou `DROP CONSTRAINT` suivis de leur recréation) : confirmer.
3. **Résultat attendu** : une ligne `migration = 20261101000000 appliquée`, `controles_reussis = 13`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `whatsapp_export_import` avec `md5_texte = 2070fedbbc2cfd339544e330a0540411`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #41 seulement ensuite.

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
