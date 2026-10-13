# PR #42 : migration `20261102000000_publications_editorial_intelligence.sql`

Intelligence éditoriale de l'Agent Publications v2 : justification éditoriale enregistrée avec chaque préparation. Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-13. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261102000000_publications_editorial_intelligence.sql` (3667 octets, md5 `3b2de8f168d15f3ea1625cb634f47d4e`) |
| Nom dans l'historique | `publications_editorial_intelligence` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `whatsapp_export_import` (#41, pour respecter l'ordre de fusion). |
| Contrôles après application | 11, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- Colonne `publication_agent_v2_runs.editorial_justification` (jsonb, **nullable, sans défaut** : aucune ligne réécrite), objet JSON de 16 000 octets au plus.
- Déclencheur `agent_v2_run_justification_guard` (fonction `publications_private.guard_agent_v2_justification`) : la justification n'est posée qu'une fois, pendant la préparation, puis elle est immuable. Le garde historique du run (`guard_agent_v2_run`) n'est **pas** modifié.
- RPC `public.publication_editorial_justification_record(p_run_id uuid, p_justification jsonb, p_actor_id text)` : enregistrement par le serveur (Agent v2), validation de la forme (`version` numérique, `outcome` = `prepared` ou `refused`), refus après la fin du run ou d'une seconde écriture.
- Index GIN `publication_agent_v2_runs_publications` sur `publication_ids` (lecture « run d'une publication » pour le panneau).
- Droits : fonctions `SECURITY INVOKER`, `search_path = pg_catalog`, exécution retirée à `public`/`anon`/`authenticated`, accordée à `service_role`.

**Données existantes** : aucune ligne existante modifiée (contrôlé : aucune justification renseignée après application).

**Publication automatique** : la migration n'active rien. Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : `ALTER TABLE … ADD COLUMN` nullable sans défaut et création d'index sur `publication_agent_v2_runs` (petite table d'historique) : verrou bref. Le script pose `lock_timeout = 5s` : il abandonne plutôt que de faire attendre l'application.

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Le texte officiel est transporté en base64 et son md5 contrôlé (insensible aux fins de ligne CRLF). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` à partir du fichier officiel ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de la PR #41 est appliquée et inscrite, et cette PR n'est **pas encore fusionnée**.
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ». Confirmer si Supabase signale une opération potentiellement destructive (`ALTER TABLE`).
3. **Résultat attendu** : une ligne `migration = 20261102000000 appliquée`, `controles_reussis = 11`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `publications_editorial_intelligence` avec `md5_texte = 3b2de8f168d15f3ea1625cb634f47d4e`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #42 seulement ensuite.

Si la PR est fusionnée avant la migration, l'Agent v2 continue de fonctionner : l'enregistrement de la justification échoue sans bloquer la préparation (journalisé sans contenu) et le panneau n'affiche simplement pas de justification.

## Ordre de déploiement complet

| Étape | Migration | PR |
| --- | --- | --- |
| 1 | `20261028000000_media_library_intelligence` | #37 |
| 2 | `20261029000000_publications_editorial_selection` | #38 |
| 3 | `20261030000000_publications_scheduled_flow` | #39 |
| 4 | `20261031000000_publications_supervision` | #40 |
| 5 | `20261101000000_whatsapp_export_import` | #41 |
| 6 | `20261102000000_publications_editorial_intelligence` | #42 |

Pour chaque ligne : appliquer, inscrire, vérifier, puis fusionner la PR, avant de passer à la suivante.

## Tests réalisés

`node scripts/migration-kit.mjs --check 42` reconstruit en local une réplique de la production (schéma, migrations déjà appliquées, historique au format du projet, jeu de données représentatif), puis :

- l'inscription est refusée tant que la migration n'est pas appliquée ;
- le script d'application passe, en fins de ligne LF **et** CRLF, et laisse les données existantes intactes ;
- l'inscription écrit le texte officiel (md5 contrôlé) ;
- `verify.sql` renvoie uniquement `true` ;
- une seconde application et une seconde inscription sont refusées.

`supabase/tests/publications-socle-6-editorial-intelligence.sql` (38 vérifications, via `tests/publications-socle-db.test.mjs`, deux reconstructions de la chaîne complète) couvre les droits, la forme, l'enregistrement unique pendant la préparation, l'immuabilité après la fin ou l'échec du run, la lecture par publication et l'absence de toute diffusion.

Réplique locale en PostgreSQL 16 ; la production est en PostgreSQL 17.
