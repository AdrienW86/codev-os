# Migration des décisions Publications appliquée — 5 octobre 2026

## 1. Migration distante

Seul le fichier `20261005202218_publications_revision_decisions.sql` a été appliqué
au projet **codev-os**, référence `lehlbcnpufkllcykvtlg`, après autorisation explicite.
Le SQL appliqué est identique au fichier validé, SHA-256 :
`9DEA64030BD75659CA29BE42E7FF1A1B433E44EE910252F6A9A9E144DF1EC2CE`.

Le connecteur Supabase a enregistré automatiquement la version **20261005204052**
sous le nom `20261005202218_publications_revision_decisions`.
L'historique passe de huit à neuf entrées ; les huit précédentes sont inchangées.
Aucune autre migration, baseline, db push ou correction d'historique n'a été appliquée.

## 2. Précontrôles

- Migration absente avant application, par nom et par version.
- Projet codev-os confirmé actif et sain, PostgreSQL 17.11.
- Treize tables Publications et 134 colonnes : noms, types et nullabilité comparés
  aux migrations locales précédemment validées, sans divergence.
- Corps des quatre fonctions concernées identiques à la version précédente validée ;
  sept contraintes et trois index sur les reviews, conformément au dernier contrôle.
- RLS active ; aucun accès public, anon ou authenticated ; accès serveur conservé.
- Deux anciennes reviews et une publication refusée présentes.
- Zéro job et zéro delivery, zéro client/compte Publications activé ; pg_cron absent.
- Arrêt général actif ; génération, automatisation et publication désactivées.

Le dump historique restaurable existe toujours :
`backups/pre-migration-2026-10-05/20261005T174418Z/public.dump`, **53 446 octets**.
Son catalogue est lisible par `pg_restore --list` et son SHA-256 est inchangé :
`754AE7BE04F419578EC90E9D5DB6F337CCD61CE0B7C9BF3082EBDE983C726915`.
Il s'agit du dump initial, dont la restauration locale avait été validée ; aucun
nouveau dump n'a été créé pendant cette opération.

## 3. Anciennes reviews

Les deux anciennes lignes sont toujours présentes. Comparaison de l'identifiant
et de l'empreinte MD5 de chaque ligne entière avant/après : identiques.
Leurs variantes, motifs, acteurs et dates n'ont pas été modifiés.
Les protections UPDATE, DELETE et TRUNCATE des reviews restent actives.
Aucune suppression ni consolidation physique de données historiques.

## 4. RPC et nouvelle décision

La RPC `publication_review_manual` et les trois fonctions de contrôle
`check_publication_state`, `check_review`, `check_delivery` correspondent exactement
au SQL autorisé. Elles restent SECURITY INVOKER avec `search_path=pg_catalog`.
Exécution de la RPC : service_role autorisé, anon et authenticated refusés.
FK révision/publication/client, `variant_id` nullable et index unique partiel vérifiés.

Un test a réellement invoqué les RPC distantes en tant que service_role, avec un
client, un projet et une publication synthétiques, dans une transaction explicitement
annulée par **ROLLBACK** :

| Contrôle | Résultat |
| --- | --- |
| Refus d'une révision à deux variantes | Une review globale, un événement |
| Répétition du même refus | Aucune insertion supplémentaire |
| Nouvelle révision après refus | Aucune décision héritée |
| Répétition sur l'ancienne révision | Refus 40001 |
| Approbation de la nouvelle révision à deux variantes | Une review globale, un événement |
| Répétition de l'approbation | Aucune insertion supplémentaire |
| Jobs et deliveries créés par ces opérations | Zéro |

Après rollback : aucun client ni projet synthétique ne subsiste ; une publication
réelle, deux anciennes reviews, zéro review globale persistée et un événement de
validation. Le test n'a pas laissé de nouvelle décision en base.

## 5. Fiche réelle

Le rendu serveur du composant de fiche a été exécuté après migration avec les
lectures Supabase réelles, sous une garde admin de test : une décision logique
chargée, une occurrence du motif, un événement, zéro erreur.
L'authentification de l'application n'a pas été modifiée ; ce contrôle ne constitue
pas un test navigateur avec une session Clerk.

## 6–9. Validations locales relancées

- `npm run test:publications` : 18 réussis, zéro échec.
- Tous les tests Node : **132 réussis**, zéro échec et zéro test ignoré.
- Tests SQL exécutés sur PostgreSQL local 17.11 : deux reconstructions complètes,
  55 assertions Publications Lot 2 par reconstruction ; tests Lot 1, scope,
  historique et permissions réussis également.
- Deux sessions PostgreSQL locales simultanées : une review globale, un événement,
  deux appels réussis ; idempotence et verrou interne de RPC vérifiés.
- `npm run lint` : réussi.
- `npm run typecheck` : réussi.
- `npm run build` : réussi ; routes Publications compilées.

Le cluster jetable écoutait uniquement sur 127.0.0.1 et a été arrêté.

## 10. Périmètre respecté

Seule la migration autorisée et son enregistrement sont des modifications distantes
persistantes. Les écritures synthétiques de validation ont toutes été annulées.
Aucune autre migration, modification des anciennes reviews, nettoyage historique,
publication externe, installation de worker/cron ou changement de kill switch.
Le Lot 3 n'a pas été commencé.
