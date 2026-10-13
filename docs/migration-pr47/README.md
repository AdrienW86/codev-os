# PR #47 : migration `20261106000000_publications_robustness.sql`

Robustesse et charge du pipeline Publications (phase 8). Kit d'application manuelle dans le SQL Editor de Supabase (projet `codev-os`), préparé le 2026-10-13. **Rien n'a été appliqué en production.**

| | |
| --- | --- |
| Fichier officiel | `supabase/migrations/20261106000000_publications_robustness.sql` (4461 octets, md5 `0f4662e0a13d46cc9580728b2e71dc71`) |
| Nom dans l'historique | `publications_robustness` (convention du projet : version = horodatage de l'inscription) |
| Prérequis | `whatsapp_export_import` (#41), donc toute la pile #37 à #41. |
| Contrôles après application | 6, plus 2 contrôles d'historique et d'interrupteurs dans `verify.sql` |

## Ce que fait la migration

- **Remplace** `public.publication_job_claim_on_time(text,integer,integer)` (créée par #39) : la garde « jamais plus de 2 h de retard » s'applique aussi aux **réessais automatiques**. La référence n'est plus `run_at` (repoussé à chaque réessai) mais l'heure due de la diffusion, ou la dernière relance par un humain si elle est plus récente. Même signature, toujours `SECURITY INVOKER`, `search_path=pg_catalog`, réservée à `service_role`.
- **Crée** `public.publication_job_claim_scheduled(text,integer,integer,text[])` : même réservation, limitée aux plateformes dont l'envoi tient dans le temps restant du passage. Si la tâche en tête de file est d'une autre plateforme, la réservation est annulée (sous-transaction) et rien n'est pris : aucune tentative consommée, aucun dépassement dans la file.

**Données existantes** : aucune ligne modifiée, aucune table créée ni modifiée.

**Publication automatique** : la migration n'active rien. La diffusion planifiée reste sous `PUBLICATIONS_SCHEDULED_DELIVERY` (vide par défaut) et sous les interrupteurs en base (arrêt d'urgence, publication). Le script vérifie à la fin que le nombre de clients en préparation automatique et l'arrêt d'urgence global sont inchangés.

**Verrous** : aucun verrou de table (remplacement et création de fonctions). Le script pose `lock_timeout = 5s`.

## Précautions particulières

- Le script s'arrête si `publication_job_claim_on_time` n'est pas exactement la version de #39 (code comparé par empreinte) : appliquer #39 à #41 d'abord.
- Effet visible après application : une diffusion en réessai automatique dont l'heure due est dépassée de plus de 2 h est **bloquée** (`late_schedule`, notifiée « Échec ou incertitude d'envoi ») au lieu de partir en retard. Un humain la relance depuis la fiche publication s'il le souhaite.

## Fichiers

- [apply_sql_editor.sql](apply_sql_editor.sql) : contrôles préalables (prérequis dans l'historique, migration jamais appliquée, fonction remplacée identique à la version attendue), photographie des données, migration du dépôt **octet pour octet**, vérifications, compte rendu. Une seule transaction : au moindre écart, rien n'est appliqué.
- [sync_migration_history.sql](sync_migration_history.sql) : inscription dans l'historique. Texte officiel transporté en base64, md5 contrôlé (insensible aux fins de ligne CRLF d'un copier-coller). Refuse d'écrire si la migration n'est pas réellement en place ou déjà inscrite.
- [verify.sql](verify.sql) : contrôles en lecture seule, à relancer à tout moment ; chaque ligne doit indiquer `ok = true`.
- [kit.json](kit.json) : paramètres du kit. Les trois scripts sont générés par `node scripts/migration-kit.mjs` ; ne pas les modifier à la main.

## Procédure

1. **Avant tout** : la migration de #41 est appliquée et inscrite, et cette PR n'est **pas encore fusionnée**.
2. **Appliquer** : SQL Editor, « New query », coller **tout** `apply_sql_editor.sql`, « Run ».
3. **Résultat attendu** : une ligne `migration = 20261106000000 appliquée`, `controles_reussis = 6`, `clients_avec_preparation_automatique = 0`, `interrupteurs = emergency_stop=true …`.
4. **En cas d'erreur** : un message `ARRET : …` ou `VERIFICATION : …` signifie que **rien n'a été appliqué**. Ne pas réessayer autrement : me transmettre le message.
5. **Inscrire l'historique**, seulement si l'étape 3 est correcte : nouvelle requête, coller `sync_migration_history.sql`, « Run ». Attendu : une ligne `publications_robustness` avec `md5_texte = 0f4662e0a13d46cc9580728b2e71dc71`.
6. **Vérifier** : nouvelle requête, coller `verify.sql`, « Run » : toutes les lignes à `true`.
7. **Fusionner** la PR #47 seulement ensuite. Le code de #47 appelle `publication_job_claim_scheduled` pour les envois suivant le premier d'un passage : déployer le code avant la migration n'enverrait rien de plus (réservation refusée, passage arrêté), mais appliquer d'abord la migration.

## Ordre de déploiement complet

| Étape | Migration | PR |
| --- | --- | --- |
| 1 | `20261028000000_media_library_intelligence` | #37 |
| 2 | `20261029000000_publications_editorial_selection` | #38 |
| 3 | `20261030000000_publications_scheduled_flow` | #39 |
| 4 | `20261031000000_publications_supervision` | #40 |
| 5 | `20261101000000_whatsapp_export_import` | #41 |
| 6 | `20261106000000_publications_robustness` | #47 |

Pour chaque ligne : appliquer, inscrire, vérifier, puis fusionner la PR, avant de passer à la suivante.

## Tests réalisés

`node scripts/migration-kit.mjs --check 47` reconstruit en local une réplique de la production (schéma de production, migrations déjà appliquées, historique au format du projet, clients, réglages), puis :

- l'inscription est refusée tant que la migration n'est pas appliquée ;
- le script d'application passe, en fins de ligne LF **et** CRLF, et laisse les données existantes intactes ;
- l'inscription écrit le texte officiel (md5 contrôlé) ;
- `verify.sql` renvoie uniquement `true` ;
- une seconde application et une seconde inscription sont refusées.

Côté comportement : `tests/publications-load-db.test.mjs` (suite `publications-load-1-delivery.sql`, 222 vérifications, et essais à deux sessions) et la suite P10 complète (`tests/publications-scheduled-flow-db.test.mjs`, inchangée et verte après cette migration).

Réplique locale en PostgreSQL 16 ; la production est en PostgreSQL 17 (les contrôles portent sur le code des fonctions, les droits et la présence des objets, identiques entre versions).
