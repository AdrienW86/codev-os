# Décision manuelle Publications — correction du doublon

Mise à jour : la migration a depuis été autorisée et appliquée au distant.
Voir le [rapport d'application](publications-revision-decisions-applied.md).
Les sections suivantes décrivent le diagnostic et la préparation avant cette application.

## Constat distant en lecture seule

La publication concernée contient deux lignes `publication_reviews` pour la même
révision, chacune avec un `variant_id` différent. Les décisions sont `rejected`,
avec le même horodatage. Le journal contient un seul événement `publication.reviewed`.

La RPC `publication_review_manual` de 00005 exécute un `INSERT ... SELECT` sur toutes
les variantes de la révision. Deux variantes produisent donc deux reviews au cours
du même appel. Il ne s'agit pas d'un double clic : le verrou `FOR UPDATE` et le
contrôle du statut empêchent déjà une deuxième décision après le refus.

`getWorkspace()` lit les révisions, variantes et reviews dans des requêtes
indépendantes, filtrées par publication. Aucune jointure embarquée 1-N et aucun
flatten ne multiplie les lignes. La fiche affichait ensuite les mêmes reviews
dans la validation actuelle et dans l'historique de la révision actuelle.

## Correction applicative

`lib/publications/review-decisions.ts` définit le modèle de lecture des décisions.
Pour les anciennes décisions globales de 00005, la décision provient de l'événement
enregistré et des reviews de sa transaction : même publication/client/révision,
acteur, décision, horodatage et motif ; une review pour chaque variante ; un seul
événement correspondant. Si cette preuve est incomplète ou contradictoire, les
reviews restent indépendantes. Les décisions par variante de l'ancienne RPC,
reconnaissables à leurs métadonnées, restent indépendantes aussi.

Ce modèle est appliqué dans `getWorkspace()`, sans Set ni suppression de données.
Les décisions actuelles apparaissent seulement dans le panneau de validation.
Elles passent dans l'historique lorsque la révision change.

Le rendu serveur de la fiche réelle a été exécuté avec les lectures Supabase réelles
et une garde admin de test, sans modifier l'authentification applicative : une
décision chargée, une occurrence du motif, un événement, zéro erreur. Ce contrôle
n'utilise pas une session navigateur Clerk.

## Correction du stockage et de la RPC, prête localement

Migration créée avec le CLI officiel, **non appliquée au distant** :
`20261005202218_publications_revision_decisions.sql`.

SHA-256 : `9DEA64030BD75659CA29BE42E7FF1A1B433E44EE910252F6A9A9E144DF1EC2CE`.

- Une décision globale manuelle est une review avec `variant_id=NULL`.
- FK explicite vers la révision/publication/client, pour préserver la protection
  inter-clients lorsque la FK de variante ne s'applique pas.
- Index unique partiel : une seule décision globale par révision.
- Trigger interdisant de mélanger décisions globales et décisions par variante.
- RPC verrouillant la publication, insérant une seule review et un seul événement.
- Répétition identique sur la même révision/acteur/décision/motif : succès sans
  insertion supplémentaire. Décision contradictoire ou révision périmée : refus.
- Contrôles d'approbation et d'éligibilité des deliveries adaptés à la décision
  globale, toujours liée à la révision actuelle. Aucun publish, job ou worker ajouté.
- RLS, ACL serveur, permissions append-only et kill switch conservés.

Les deux anciennes reviews restent intactes pour préserver l'historique append-only.
La migration ne supprime ni ne modifie aucune donnée existante. La règle « une
décision = une ligne » concerne les nouvelles décisions globales après application.
Tant que cette migration n'est pas appliquée, la RPC distante conserve son écriture
historique par variante ; la correction d'affichage fonctionne déjà avec ce modèle.

## Validation

- Tests Publications ciblés : 18 réussis ; tests workspace et décision/rendu :
  12 réussis.
- Suite Node complète : 132 tests réussis, aucun échec, aucun test ignoré.
- Deux reconstructions PostgreSQL locales avec sept migrations : 55 assertions
  par reconstruction, dont préservation des anciennes reviews, idempotence,
  décision globale sur deux plateformes, nouvelle révision et rollback d'audit.
- Deux sessions PostgreSQL simultanées invoquant réellement la RPC : deux appels
  réussis, une review et un événement. Le verrou provient de la RPC elle-même.
- Suites SQL Lot 1, scope, schéma historique et permissions : réussies.
- Lint, typecheck et build : réussis.

## Application proposée après autorisation distante

1. Vérifier l'état courant et sauvegarder l'état précédant cette correction.
2. Appliquer uniquement cette migration versionnée, dans une transaction.
3. Vérifier FK, index unique, triggers, définition de RPC, ACL et RLS.
4. Vérifier que les deux reviews historiques et leur événement sont inchangés.
5. Vérifier les flags : arrêt général actif, toutes les activations désactivées.

Aucune migration ni écriture distante n'a été effectuée pendant ce diagnostic.
Le Lot 3 n'a pas été commencé.
