# Publications — Lot 1

## Périmètre

Socle versionné, contenu manuel interne, validation par variante, historique,
file persistante préparée et pages en lecture seule. Aucun fournisseur IA,
connecteur, credential réel, cron, worker, email ou appel à Google, Meta,
Make, Airtable ou Drive. Les services métier n'accèdent qu'à Supabase depuis
le serveur. Aucun appel réseau ni migration distante n'est nécessaire aux tests
application ou à la compilation.

La branche est `feature/publications`. Le dépôt comportait déjà des changements
non commités : ils ne constituent pas le diff de ce lot. Les tables métier
existantes et leurs politiques ne sont pas modifiées. `public.clients(id uuid)`
est un prérequis ; les clients restent des entités métier, sans compte Clerk.

## Migrations et installation

1. `20261005000000_publications_schema.sql` : 13 tables, contraintes,
   index, singleton, RLS et permissions.
2. `20261005000001_publications_transactions.sql` : triggers et trois RPC.

Les migrations sont appliquées **une fois**, dans l'ordre, par l'historique
Supabase. Elles ne sont pas des scripts SQL à relancer sur un schéma déjà créé :
pas de `IF NOT EXISTS` masquant une divergence. Leur rejouabilité signifie
reconstruction d'une base isolée depuis zéro. Le test SQL reconstruit deux fois
le module et annule chaque reconstruction avec `ROLLBACK`.

Le CLI Supabase, Docker et PostgreSQL n'étaient pas disponibles lors de la
préparation du lot. Les fichiers ont donc été préparés localement sans installer
d'outil ni accéder au réseau. Les prochaines migrations doivent être créées
avec `supabase migration new <nom>` lorsque le CLI est disponible.

Une baseline locale versionnée existe maintenant dans `supabase/local/baseline.sql`,
reconstruite d'après le contrat du dépôt, sans consultation du projet distant.
Elle est réservée aux tests et ne certifie pas les defaults/politiques inconnus de production.
Les quatre migrations Publications et scope projet sont réellement reconstruites deux fois
sur PostgreSQL portable 17.11. Voir le [rapport local](publications-local-validation.md).

Sur une base CODE-V OS de développement locale possédant déjà `clients`,
appliquer les migrations via le CLI local après avoir découvert ses options avec
`--help`. Toute application distante, configuration d'un service ou déploiement
demande une autorisation distincte. Les pages montrent une erreur de stockage
si les tables manquent ; elles n'inventent aucune publication ou configuration.

## Modèle

Deux sujets éditoriaux par semaine et par client, chacun avec un slot 1 ou 2.
Une semaine est identifiée par son lundi (date locale), indépendamment de l'heure.
Les variantes peuvent différer pour `google_business_profile`, `facebook` et
`instagram`, soit jusqu'à six diffusions pour deux sujets.

| Table | Rôle |
| --- | --- |
| publication_settings | Singleton des autorisations globales et arrêt général |
| publication_client_settings | Brief, fuseau, deux créneaux et activations |
| publication_accounts | Comptes cibles par client/plateforme, désactivés initialement |
| publications | Sujet, semaine, slot, état et pointeur vers la version actuelle |
| publication_revisions | Historique immuable des versions et de leur origine |
| publication_variants | Texte et plateforme propres à une version |
| publication_assets | Référence média, hash SHA-256, dimensions, provenance et droits |
| publication_variant_assets | Médias ordonnés d'une variante |
| publication_reviews | Une décision définitive par variante et version |
| publication_deliveries | Une diffusion logique par publication et compte |
| publication_jobs | Tâches futures persistantes et dédupliquées |
| publication_attempts | Tentatives immuables liées à la tâche et à sa diffusion |
| publication_events | Journal métier append-only |

Les colonnes `client_id`, `publication_id`, `revision_id` et `platform`
supplémentaires servent aux FK composites : un média d'un autre client, une
variante d'une autre publication ou un compte d'une autre plateforme sont
refusés en base. La FK de la version courante impose son appartenance au sujet.
Les FK sont restrictives ; aucun client ayant des données Publications ne peut
être effacé en cascade. Ce lot n'expose aucune suppression ni édition du sujet,
de la semaine ou du slot après création.

`weekly_slots` est un tableau de exactement deux objets `{day,time}`, avec jour
ISO numérique de 1 à 7 et heure `HH:mm`. Le fuseau est vérifié en base avec
`pg_timezone_names`. Valeur initiale : `Europe/Paris`, mardi et vendredi 10 h.
Ce lot ne calcule ni ne programme les diffusions à partir de ces créneaux.

`publication_accounts.metadata` et `publication_variants.metadata` acceptent
seulement des chaînes bornées pour `label`, `locale`, `account_name`, `alt_text`.
Cette liste réduit le risque de secrets accidentels ; elle ne permet pas de
détecter un secret volontairement placé dans un libellé. Aucun formulaire ou
service de ce lot n'y stocke de credential.
`credential_reference` est une référence abstraite `ref:...`, jamais un token.

## Versions et décisions

```text
draft -> pending_review -> approved ou rejected
nouvelle révision (y compris après refus) -> pending_review
```

La création manuelle fournit un snapshot complet de 1 à 3 variantes et soumet
la première version. Le modèle `draft` est préparé mais aucun éditeur de brouillon
n'est encore exposé. Une variante ne se modifie pas en place : tout changement
de texte, de médias ou de plateformes passe par une nouvelle version.
Les versions, médias, décisions et tentatives sont immuables ; ajouter une
variante ou un média à une version déjà examinée est également interdit.

La validation est **par variante**, avec `variant_id` obligatoire. L'approbation
globale n'arrive que lorsque toutes les variantes de la version courante ont
été approuvées. Le premier refus clôt cette version avec un motif obligatoire
et crée une tâche `regenerate` dédupliquée par version. Une nouvelle version
requiert de nouvelles décisions ; les anciennes restent consultables.

Une révision bloque les anciennes diffusions non annulées et annule les tâches
en attente/en cours dans la même transaction. Elle est refusée en présence
d'une diffusion `processing`, `published` ou `uncertain`, afin de ne pas perdre
un résultat distant à réconcilier. La gestion détaillée de ces états est future.

## Transactions et concurrence

Trois fonctions publiques, toutes `SECURITY INVOKER` avec `search_path=pg_catalog` :

| RPC | Opération atomique |
| --- | --- |
| publication_create_manual | Publication, version, variantes/médias et événement |
| publication_revise_manual | Version complète, invalidation des diffusions/tâches, événement |
| publication_review | Décision, état, tâche de régénération éventuelle et événement |

Le backend dérive l'acteur depuis `requireAdmin()` ; l'utilisateur ne fournit
jamais `actor_id` au service. La base vérifie le format Clerk mais ne valide pas
elle-même une session Clerk : la clé privilégiée est la frontière de confiance.

Révision et validation verrouillent la publication avec `FOR UPDATE`. Les
triggers de contenu utilisent le même verrou. `expected_revision_id` refuse
une modification fondée sur une version obsolète. Les contraintes d'unicité
restent l'autorité pour les créations concurrentes. Si l'audit échoue, la mutation
et la tâche sont annulées avec lui. Les réponses réseau perdues après COMMIT
restent possibles : le service demande de recharger avant un rejeu.

Les RPC sont les seuls chemins de mutation métier utilisés par le code de ce
lot. Une écriture SQL directe avec une clé serveur ou un compte propriétaire
reste privilégiée et peut contourner le parcours métier : ne pas l'utiliser
comme API de mutation. Les futurs réglages, comptes, uploads et workers devront
ajouter des transactions et audits adaptés ; ils ne sont pas implémentés ici.

## Sécurité et permissions

Chaque table a RLS activée, sans policy. `PUBLIC`, `anon` et `authenticated`
n'ont aucun droit sur les tables ou RPC. Le rôle serveur a les droits requis
pour les RPC ; aucune suppression ni TRUNCATE n'est accordée.
Les historiques retirent également UPDATE ; des triggers refusent UPDATE,
DELETE et TRUNCATE même pour les accès propriétaire ordinaires. Un superuser
pouvant supprimer les triggers reste naturellement hors de cette garantie.

Les helpers vivent dans `publications_private`, sans accès des rôles navigateur,
avec un chemin explicite. Aucune fonction `SECURITY DEFINER` n'est nécessaire.
Les pages, lectures et services imposent `requireAdmin()` ; interruptions
d'authentification hors des blocs qui filtrent les erreurs de stockage.
La clé Supabase privilégiée demeure uniquement dans le client `server-only`
existant et contourne RLS : RLS ne remplace pas le contrôle administrateur.

## Arrêt général

Valeurs installées : génération=false, automatisation=false,
publication=false, arrêt général=true. Lever un drapeau tout en conservant
l'arrêt général actif est refusé par une contrainte de cohérence.
Une configuration absente est refusée par défaut.

Les pages `/publications` et `/settings` présentent les réglages réels en
**lecture seule**. Aucun bouton d'activation, aucune Server Action, aucun
connecteur ou worker : même des flags modifiés par SQL ne font rien exécuter.
La garde TypeScript préparatoire vérifie arrêt, permission globale, permission
client et compte actif connecté appartenant au même client. Le futur worker
devra en plus vérifier automation, version approuvée, cible, média, autorisation
d'environnement et configuration, immédiatement avant chaque appel externe.
Il devra proposer un vrai bouton d'arrêt audité avant activation de l'automatisation.

## Médias

Modèle seulement : pas d'upload, pas de bucket créé ni de policy Storage ajoutée.
Prévoir un bucket privé `publication-assets`, chemins `{client_id}/...`, accès
serveur et URL temporaires lorsque les plateformes sont intégrées. Vérifier les
droits des médias avant toute approbation opérationnelle et diffusion.
Les hashes sont SHA-256 ; le futur service d'upload calculera le hash et
vérifiera MIME réel, dimensions, taille, provenance et droits.

## Jobs et idempotence

Types futurs : generate, regenerate, deliver, reconcile. La tâche de refus
reste `pending`, sans exécuteur. Tentatives bornées à max_attempts (1 à 10),
verrou cohérent avec l'état processing, références de diffusion/version
contrôlées. Index de recherche des tâches et des diffusions arrivées à échéance.

Unicités : sujet par client/semaine/slot, version par sujet/numéro, variante
par version/plateforme, décision par variante, diffusion par sujet/compte,
clé d'idempotence, ID distant par compte, clé de tâche, numéro de tentative.
Un rejeu ne crée jamais une seconde diffusion logique. Les états `uncertain`
préparent la réconciliation ; ce lot ne promet pas un exactly-once externe.

## Vérifications

```sh
npm run lint
npm run typecheck
npm run build
npm test
npm run test:publications:db
```

Les tests application simulent Clerk et Supabase, rendent le HTML des pages,
vérifient autorisations, erreurs filtrées, pagination, RPC, configurations sûres,
transitions, versions, états vides et absence de transports externes.

Pour les tests PostgreSQL réels, préparer soi-même une base **vide**, isolée,
sur loopback, nommée `publications_lot1_test` (ou ce préfixe avec suffixe).
Utiliser un compte local de test capable de créer les rôles de la fixture et
de faire `SET ROLE`, jamais le projet distant. Définir uniquement dans le
terminal `PUBLICATIONS_TEST_DATABASE_URL` et éventuellement
`PUBLICATIONS_TEST_PSQL` (chemin d'un psql déjà installé), puis lancer le script.
Le runner refuse tout hôte distant et toute option URL ; il ne charge pas `.env`.
Il ne supprime aucune base et refuse une base non vide. Les tables, rôles de
fixture éventuellement créés et tests sont annulés par transaction, deux fois.
Ne jamais afficher ni committer l'URL contenant le mot de passe.

`supabase/tests/publications.sql` vérifie reconstruction, RLS/ACL/RPC,
slots, FK, droits médias/client, unicités, historique immuable, configuration,
validation liée à la version, tâches, invalidation et rollback sur échec d'audit.
Le script dédié `test:publications:db` échoue sans configuration locale ; `npm test`
peut ignorer les intégrations SQL sans base configurée. La validation locale complète
exécute réellement ces suites, sans aucun test ignoré. Les scénarios de concurrence
entre plusieurs sessions restent à tester séparément.

## Lots suivants

Lot 2 : édition réelle, création manuelle via Server Actions, choix du client,
versions et consultation du journal ; compléter les tests avec PostgreSQL
local et préparer le stockage privé avant upload.
Puis validation UI, calendrier/fuseaux, worker simulé et bouton d'arrêt audité.
Les lots IA, OAuth, connecteurs, cron et déploiement seront autorisés séparément.
